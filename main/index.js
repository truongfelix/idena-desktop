const {join, resolve} = require('path')
const {
  BrowserWindow,
  app,
  ipcMain,
  Tray,
  Menu,
  nativeTheme,
  net,
  protocol,
  shell,
  // eslint-disable-next-line import/no-extraneous-dependencies
} = require('electron')
const {autoUpdater} = require('electron-updater')
const fs = require('fs-extra')
const i18next = require('i18next')
const macosVersion = require('macos-version')
const semver = require('semver')
const axios = require('axios')
const kill = require('tree-kill')
const {zoomIn, zoomOut, resetZoom, isNotFoundError} = require('./utils')
const loadRoute = require('./utils/routes')
const {getI18nConfig} = require('./language')
const {searchImages} = require('./image-search')
const {openExternalUrl} = require('./safe-external-url')
const {isTrustedIpcSender} = require('./ipc-sender')
const {
  installRendererProtocol,
  registerRendererScheme,
} = require('./renderer-protocol')
const {applyPrivateFileCreationMask} = require('./private-files')

applyPrivateFileCreationMask()
registerRendererScheme(protocol)

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const isE2ESmoke = process.env.IDENA_E2E_SMOKE === '1'
const isDev = !app.isPackaged && !isE2ESmoke

app.allowRendererProcessReuse = true

if (process.env.NODE_ENV === 'e2e') {
  app.setPath('userData', join(app.getPath('userData'), 'tests'))
  fs.removeSync(app.getPath('userData'))
}

if (isWin) {
  app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
}

const appVersion = global.appVersion || app.getVersion()

const logger = require('./logger')

logger.info('idena started', appVersion)

const {
  AUTO_UPDATE_EVENT,
  AUTO_UPDATE_COMMAND,
  NODE_COMMAND,
  NODE_EVENT,
  APP_INFO_COMMAND,
  APP_PATH_COMMAND,
  WINDOW_COMMAND,
  LOGGER_COMMAND,
  E2E_SMOKE_EVENT,
} = require('./channels')
const {
  startNode,
  downloadNode,
  updateNode,
  getCurrentVersion,
  cleanNodeState,
  getLastLogs,
  getNodeChainDbFolder,
  getNodeFile,
  getNodeIpfsDir,
  installBundledNodeOverOther,
} = require('./idena-node')

const NodeUpdater = require('./node-updater')
const {createNodeProcess} = require('./node-process')

let mainWindow
let nodeDownloadPromise = null
let tray
let e2eSmokeFinished = false

const nodeUpdater = new NodeUpdater(logger)

// The built-in node's process (main/node-process.js): one at a time, stops that wait for the exit.
const nodeProcess = createNodeProcess({
  signal: (child, signal) =>
    new Promise((resolve) => {
      if (process.platform === 'win32') {
        try {
          child.kill(signal === 'SIGKILL' ? 'SIGKILL' : undefined)
        } catch (e) {
          logger.warn('error while signalling node', e.toString())
        }
        resolve()
        return
      }
      kill(child.pid, signal, (err) => {
        if (err) logger.warn('error while signalling node', err.toString())
        resolve()
      })
    }),
  onFailed(message) {
    logger.error(message)
    sendMainWindowMsg(NODE_EVENT, 'node-failed')
  },
  logger,
})

function finishE2ESmoke(ok, detail) {
  if (!isE2ESmoke || e2eSmokeFinished) return
  e2eSmokeFinished = true

  const message = String(detail || (ok ? 'renderer ready' : 'unknown failure'))
  if (ok) {
    console.log(`[e2e-smoke] ready: ${message}`)
  } else {
    console.error(`[e2e-smoke] failed: ${message}`)
  }

  setTimeout(() => app.exit(ok ? 0 : 1), 100)
}

let dnaUrl

const isFirstInstance = app.requestSingleInstanceLock()

const extractDnaUrl = (argv) => argv.find((item) => item.startsWith('dna://'))

function isAppNavigationUrl(url) {
  try {
    const parsedUrl = new URL(String(url || ''))

    if (isDev) {
      return parsedUrl.origin === loadRoute.DEV_SERVER_ORIGIN
    }

    return loadRoute.isPackagedRendererUrl(parsedUrl)
  } catch {
    return false
  }
}

function installNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({url}) => {
    openExternalUrl(shell, url, logger)
    return {action: 'deny'}
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigationUrl(url)) {
      return
    }

    event.preventDefault()
    openExternalUrl(shell, url, logger)
  })
}

function acceptIpcSender(event) {
  const trusted = isTrustedIpcSender(event, mainWindow, isAppNavigationUrl)
  if (!trusted) logger.warn('blocked IPC from an untrusted sender')
  return trusted
}

function requireIpcSender(event) {
  if (!acceptIpcSender(event)) {
    throw new Error('Blocked IPC from an untrusted sender')
  }
}

ipcMain.on(APP_INFO_COMMAND, (event) => {
  if (!acceptIpcSender(event)) {
    event.returnValue = null
    return
  }
  event.returnValue = {
    version: appVersion,
    locale: app.getLocale(),
  }
})

ipcMain.on(APP_PATH_COMMAND, (event, folder) => {
  if (!acceptIpcSender(event) || folder !== 'userData') {
    event.returnValue = null
    return
  }
  event.returnValue = app.getPath(folder)
})

const rendererLogLevels = new Set(['debug', 'info', 'warn', 'error'])
ipcMain.on(LOGGER_COMMAND, (event, level, message) => {
  if (!acceptIpcSender(event)) return
  if (
    rendererLogLevels.has(level) &&
    typeof message === 'string' &&
    message.length <= 16 * 1024
  ) {
    logger[level]({source: 'renderer'}, message)
  }
})

if (isE2ESmoke) {
  ipcMain.once(E2E_SMOKE_EVENT, (event, status, detail) => {
    if (!acceptIpcSender(event)) return
    finishE2ESmoke(status === 'ready', detail || status)
  })
}

if (isFirstInstance) {
  app.on('second-instance', (e, argv) => {
    // Protocol handler for win32 and linux
    // argv: An array of the second instance’s (command line / deep linked) arguments
    if (isWin || isLinux) {
      // Keep only command line / deep linked arguments
      handleDnaLink(extractDnaUrl(argv))
    }

    restoreWindow(mainWindow)
  })
} else {
  app.quit()
}

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    title: app.name,
    width: 1080,
    height: 740,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      preload: join(__dirname, 'preload.js'),
    },
    icon: resolve(__dirname, 'static', 'icon-128@2x.png'),
    show: false,
  })

  installNavigationGuards(mainWindow)

  if (isE2ESmoke) {
    mainWindow.webContents.once('preload-error', (_event, preloadPath, error) =>
      finishE2ESmoke(false, `preload error: ${preloadPath}: ${error.message}`)
    )
    mainWindow.webContents.once(
      'did-fail-load',
      (_event, errorCode, errorDescription) =>
        finishE2ESmoke(
          false,
          `renderer load failed (${errorCode}): ${errorDescription}`
        )
    )
    mainWindow.webContents.once('render-process-gone', (_event, details) =>
      finishE2ESmoke(false, `renderer exited: ${details.reason}`)
    )
  }

  loadRoute(mainWindow, 'home')

  // Protocol handler for win32 and linux
  // eslint-disable-next-line no-cond-assign
  if (isWin || isLinux) {
    dnaUrl = extractDnaUrl(process.argv)
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (mainWindow.forceClose) {
      return
    }
    e.preventDefault()
    mainWindow.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const showMainWindow = () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function restoreWindow(window = mainWindow) {
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
}

function handleDnaLink(url) {
  if (!url) return
  sendMainWindowMsg('DNA_LINK', url)
}

const createMenu = () => {
  const application = {
    label: 'Idena',
    submenu: [
      {
        label: i18next.t('About Idena'),
        role: 'about',
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Toggle Developer Tools'),
        role: 'toggleDevTools',
        visible: false,
      },
      {
        label: i18next.t('Quit'),
        accelerator: 'Cmd+Q',
        role: 'quit',
      },
    ],
  }

  const edit = {
    label: i18next.t('Edit'),
    submenu: [
      {
        label: i18next.t('Undo'),
        accelerator: 'CmdOrCtrl+Z',
        role: 'undo',
      },
      {
        label: i18next.t('Redo'),
        accelerator: 'Shift+CmdOrCtrl+Z',
        role: 'redo',
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Cut'),
        accelerator: 'CmdOrCtrl+X',
        role: 'cut',
      },
      {
        label: i18next.t('Copy'),
        accelerator: 'CmdOrCtrl+C',
        role: 'copy',
      },
      {
        label: i18next.t('Paste'),
        accelerator: 'CmdOrCtrl+V',
        role: 'paste',
      },
      {
        label: i18next.t('Select All'),
        accelerator: 'CmdOrCtrl+A',
        role: 'selectAll',
      },
    ],
  }

  const view = {
    label: i18next.t('View'),
    submenu: [
      {
        label: i18next.t('Toggle Full Screen'),
        role: 'togglefullscreen',
        accelerator: isWin ? 'F11' : 'Ctrl+Command+F',
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Zoom In'),
        accelerator: 'CmdOrCtrl+=',
        click: (_, window) => {
          zoomIn(window)
        },
      },
      {
        label: i18next.t('Zoom Out'),
        accelerator: 'CmdOrCtrl+-',
        click: (_, window) => {
          zoomOut(window)
        },
      },
      {
        label: i18next.t('Actual Size'),
        accelerator: 'CmdOrCtrl+0',
        click: (_, window) => {
          resetZoom(window)
        },
      },
    ],
  }

  const help = {
    label: i18next.t('Help'),
    submenu: [
      {
        label: i18next.t('Website'),
        click: () => {
          openExternalUrl(shell, 'https://idena.io/', logger)
        },
      },
      {
        label: i18next.t('Explorer'),
        click: () => {
          openExternalUrl(shell, 'https://scan.idena.io/', logger)
        },
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Toggle Developer Tools'),
        role: 'toggleDevTools',
      },
    ],
  }

  const template = [application, edit, view, help]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function trayIcon() {
  const icon = 'icon-16-white@2x.png'
  return isMac
    ? `icon-16${nativeTheme.shouldUseDarkColors ? '-white' : ''}@2x.png`
    : icon
}

if (isMac) {
  nativeTheme.on('updated', () => {
    tray.setImage(resolve(__dirname, 'static', 'tray', trayIcon()))
  })
}

const createTray = () => {
  tray = new Tray(resolve(__dirname, 'static', 'tray', trayIcon()))

  if (isWin) {
    tray.on('click', showMainWindow)
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: i18next.t('Open Idena'),
      click: showMainWindow,
    },
    {
      type: 'separator',
    },
    {
      label: i18next.t('Quit'),
      accelerator: 'Cmd+Q',
      role: 'quit',
    },
  ])
  tray.setContextMenu(contextMenu)
}

// Prepare the renderer once the app is ready
app.on('ready', () => {
  if (!isDev) {
    try {
      installRendererProtocol({
        appPath: app.getAppPath(),
        net,
        protocol,
      })
    } catch (error) {
      logger.error('cannot install packaged renderer protocol', error)
      app.quit()
      return
    }
  }

  const i18nConfig = getI18nConfig()

  i18next.init(i18nConfig, (err) => {
    if (err) {
      logger.error(err)
    }

    createMainWindow()

    if (!isDev) {
      createMenu()
    }

    createTray()

    checkForUpdates()
  })
})

ipcMain.on(WINDOW_COMMAND, (event, command) => {
  if (!acceptIpcSender(event)) return
  switch (command) {
    case 'toggle-full-screen': {
      if (!mainWindow) return
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
      break
    }
    default:
  }
})

if (!app.isDefaultProtocolClient('dna')) {
  // Define custom protocol handler. Deep linking works on packaged versions of the application!
  app.setAsDefaultProtocolClient('dna')
}

app.on('will-finish-launching', () => {
  // Protocol handler for osx
  app.on('open-url', (event, url) => {
    event.preventDefault()
    dnaUrl = url
    if (dnaUrl && mainWindow) {
      handleDnaLink(dnaUrl)
      restoreWindow(mainWindow)
    }
  })
})

let didConfirmQuit = false

// A window that can answer the quit confirmation (asked only when the node mines: renderer ConfirmQuit).
const canConfirmQuit = () =>
  Boolean(mainWindow) &&
  !mainWindow.isDestroyed() &&
  !mainWindow.webContents.isCrashed()

app.on('before-quit', (e) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }

  if (didConfirmQuit || isDev || !canConfirmQuit()) {
    didConfirmQuit = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.forceClose = true
  } else {
    e.preventDefault()
    sendMainWindowMsg('confirm-quit')
  }
})

// The node is a child process: quitting would leave it running (on Linux and macOS until its next log line
// kills it with SIGPIPE, without a clean shutdown) and a quick restart of the app would find its ports and
// database taken. Stop it first, then quit.
let nodeStoppedForQuit = false
app.on('will-quit', (e) => {
  if (nodeStoppedForQuit || !nodeProcess.current) return
  e.preventDefault()
  nodeStoppedForQuit = true
  nodeProcess
    .stop()
    .then((log) => logger.info(log))
    .catch((err) => logger.error('error while stopping node', err.toString()))
    .finally(() => app.quit())
})

ipcMain.on('confirm-quit', (event) => {
  if (!acceptIpcSender(event)) return
  didConfirmQuit = true
  app.quit()
})

app.on('activate', showMainWindow)

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

ipcMain.handleOnce('CHECK_DNA_LINK', (event) => {
  requireIpcSender(event)
  return dnaUrl
})

ipcMain.on(NODE_COMMAND, async (event, command, data) => {
  if (!acceptIpcSender(event)) return
  logger.info(`new node command`, command, data)
  switch (command) {
    case 'init-local-node': {
      if (macosVersion.isMacOS && macosVersion.is('<10.15')) {
        return sendMainWindowMsg(NODE_EVENT, 'unsupported-macos-version')
      }

      // Our bundled node replaces another one first (the official app's: same userData folder).
      const installBundled = nodeProcess.current
        ? Promise.resolve(false)
        : installBundledNodeOverOther().catch((e) => {
            logger.error(
              'error while installing the bundled node',
              e.toString()
            )
            return false
          })
      installBundled
        .then(() => getCurrentVersion())
        .then((version) => {
          sendMainWindowMsg(NODE_EVENT, 'node-ready', version)
        })
        .catch((e) => {
          logger.error('error while getting current node version', e.toString())
          if (nodeDownloadPromise) {
            return
          }
          nodeDownloadPromise = downloadNode((info) => {
            sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-download-progress', info)
          })
            .then(() =>
              nodeProcess.stop().then(async (log) => {
                logger.info(log)
                sendMainWindowMsg(NODE_EVENT, 'node-stopped')
                await updateNode()
                sendMainWindowMsg(NODE_EVENT, 'node-ready')
              })
            )
            .catch((err) => {
              sendMainWindowMsg(NODE_EVENT, 'node-failed')
              logger.error('error while downloading node', err.toString())
            })
            .finally(() => {
              nodeDownloadPromise = null
            })
        })
      break
    }
    case 'start-local-node': {
      nodeProcess
        .start(() =>
          startNode(
            data.rpcPort,
            data.tcpPort,
            data.ipfsPort,
            data.apiKey,
            data.autoActivateMining,
            data.dbWriteBufferMiB,
            isDev,
            (log) => {
              sendMainWindowMsg(NODE_EVENT, 'node-log', log)
            }
          )
        )
        .then(({child, started}) => {
          logger.info(
            started
              ? `node started, PID: ${child.pid}`
              : `node already running, PID: ${child.pid}`
          )
          sendMainWindowMsg(NODE_EVENT, 'node-started', {
            dbWriteBufferMiB: child.dbWriteBufferMiB,
            dbWriteBufferSupported: child.dbWriteBufferSupported,
          })
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while starting node', e.toString())
        })
      break
    }
    case 'stop-local-node': {
      nodeProcess
        .stop()
        .then((log) => {
          logger.info(log)
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while stopping node', e.toString())
        })
      break
    }
    case 'clean-state': {
      // The stop waits for the node to exit: the chain DB is deleted only once it is closed.
      nodeProcess
        .stop()
        .then((log) => {
          logger.info(log)
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
          cleanNodeState()
          sendMainWindowMsg(NODE_EVENT, 'state-cleaned')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while stopping node', e.toString())
        })
      break
    }
    case 'restart-node': {
      nodeProcess
        .stop()
        .then((log) => {
          logger.info(log)
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
        })
        .then(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 1000)
            })
        )
        .then(() => {
          sendMainWindowMsg(NODE_EVENT, 'restart-node')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while stopping node', e.toString())
        })

      break
    }
    case 'get-last-logs': {
      getLastLogs()
        .then((logs) => {
          sendMainWindowMsg(NODE_EVENT, 'last-node-logs', logs)
        })
        .catch((e) => {
          logger.error('error while reading logs', e.toString())
        })
      break
    }

    case 'troubleshooting-restart-node': {
      await nodeProcess
        .stop()
        .then((log) => logger.info(log))
        .catch((e) => logger.error('error while stopping node', e.toString()))

      return sendMainWindowMsg(NODE_EVENT, 'troubleshooting-restart-node')
    }

    case 'troubleshooting-update-node': {
      if (nodeDownloadPromise) return

      await nodeProcess
        .stop()
        .then((log) => logger.info(log))
        .catch((e) => logger.error('error while stopping node', e.toString()))

      sendMainWindowMsg(NODE_EVENT, 'troubleshooting-update-node')

      nodeDownloadPromise = downloadNode((info) => {
        sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-download-progress', info)
      })
        .then(async () => {
          await updateNode()
          sendMainWindowMsg(NODE_EVENT, 'node-ready')
        })
        .catch((err) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while downloading node', err.toString())
        })
        .finally(() => {
          nodeDownloadPromise = null
        })

      break
    }

    case 'troubleshooting-reset-node': {
      await nodeProcess
        .stop()
        .then((log) => logger.info(log))
        .catch((e) => logger.error('error while stopping node', e.toString()))

      try {
        await fs.remove(getNodeFile())
        await fs.remove(getNodeChainDbFolder())
        await fs.remove(getNodeIpfsDir())

        sendMainWindowMsg(NODE_EVENT, 'troubleshooting-reset-node')
      } catch (e) {
        logger.error('error deleting idenachain.db', e.toString())
        sendMainWindowMsg(NODE_EVENT, 'node-failed')
      }

      break
    }
    default:
  }
})

nodeUpdater.on('update-available', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-update-available', info)
})

nodeUpdater.on('download-progress', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-download-progress', info)
})

nodeUpdater.on('update-downloaded', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-update-ready', info)
})

autoUpdater.on('download-progress', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'ui-download-progress', info)
})

autoUpdater.on('update-downloaded', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'ui-update-ready', info)
})

ipcMain.on(AUTO_UPDATE_COMMAND, async (event, command, data) => {
  if (!acceptIpcSender(event)) return
  logger.info(`new autoupdate command`, command, data)
  switch (command) {
    case 'start-checking': {
      nodeUpdater.checkForUpdates(data.nodeCurrentVersion, data.isInternalNode)
      break
    }
    case 'update-ui': {
      if (isWin) {
        didConfirmQuit = true
        autoUpdater.quitAndInstall()
      } else {
        openExternalUrl(
          shell,
          'https://github.com/truongfelix/idena-desktop/releases/latest',
          logger
        )
      }
      break
    }
    case 'update-node': {
      nodeProcess
        .stop()
        .then(async () => {
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
          await updateNode()
          sendMainWindowMsg(NODE_EVENT, 'node-ready')
          sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-updated')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-update-failed')
          logger.error('error while updating node', e.toString())
        })
      break
    }
    default:
  }
})

const RELEASE_URL =
  'https://api.github.com/repos/truongfelix/idena-desktop/releases/latest'

function checkForUpdates() {
  if (isDev) {
    return
  }

  async function runCheck() {
    try {
      if (isMac) {
        const {data} = await axios.get(RELEASE_URL)
        const {tag_name: tag, prerelease} = data

        if (!prerelease && semver.gt(semver.clean(tag), appVersion)) {
          setTimeout(() => {
            sendMainWindowMsg(AUTO_UPDATE_EVENT, 'ui-update-ready', {
              version: tag,
            })
          }, 30000)
        }
      } else {
        await autoUpdater.checkForUpdates()
      }
    } catch (e) {
      if (isNotFoundError(e)) {
        logger.info('no app release published yet')
      } else {
        logger.error('error while checking UI update', e.toString())
      }
    } finally {
      setTimeout(runCheck, 10 * 60 * 1000)
    }
  }

  runCheck()
}

ipcMain.on('reload', (event) => {
  if (!acceptIpcSender(event)) return
  loadRoute(mainWindow, 'home')
})

ipcMain.on('showMainWindow', (event) => {
  if (!acceptIpcSender(event)) return
  showMainWindow()
})

function sendMainWindowMsg(channel, message, data) {
  if (!mainWindow || !mainWindow.webContents || mainWindow.forceClose) {
    return
  }
  try {
    mainWindow.webContents.send(channel, message, data)
  } catch (e) {
    logger.error('cannot send msg to main window', e.toString())
  }
}

ipcMain.handle('search-image', async (event, query) => {
  requireIpcSender(event)
  return searchImages(query, {logger})
})

const KEY_VALUE = Object.create(null)
const MEMORY_KEYS = new Set(['idena-bot'])

ipcMain.handle('get-data', async (event, key) => {
  requireIpcSender(event)
  return MEMORY_KEYS.has(key) ? KEY_VALUE[key] : undefined
})
ipcMain.on('set-data', (event, key, value) => {
  if (!acceptIpcSender(event) || !MEMORY_KEYS.has(key)) return
  KEY_VALUE[key] = Boolean(value)
})
