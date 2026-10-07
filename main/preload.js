// eslint-disable-next-line import/no-extraneous-dependencies
const electron = require('electron')

const {clipboard, contextBridge, ipcRenderer, nativeImage, shell, webFrame} =
  electron

const levelup = require('levelup')
const leveldown = require('leveldown')
const sub = require('subleveldown')

const {
  APP_INFO_COMMAND,
  E2E_SMOKE_EVENT,
  LOGGER_COMMAND,
  WINDOW_COMMAND,
} = require('./channels')
const flips = require('./stores/flips')
const invites = require('./stores/invites')
const {prepareDb, dbPath} = require('./stores/setup')
const {openExternalUrl} = require('./safe-external-url')
const {createSafeIpcRenderer} = require('./safe-ipc-renderer')
const {createSafeImageBridge} = require('./safe-image-bridge')
const {createDatabaseBridge} = require('./database-bridge')
const {createPersistentStateBridge} = require('./safe-store-bridge')
const {createRendererLogger} = require('./safe-renderer-logger')
const {applyPrivateFileCreationMask} = require('./private-files')

applyPrivateFileCreationMask()

function getAppInfo() {
  try {
    return ipcRenderer.sendSync(APP_INFO_COMMAND) || {}
  } catch {
    return {}
  }
}

function expose(name, value) {
  contextBridge.exposeInMainWorld(name, value)
}

function exposeMethods(source, methodNames) {
  return Object.freeze(
    Object.fromEntries(
      methodNames.map((name) => [name, (...args) => source[name](...args)])
    )
  )
}

const appInfo = getAppInfo()
const [locale] = String(appInfo.locale || 'en').split('-')
const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.ELECTRON_IS_DEV === '1' ||
  process.defaultApp === true
const safeIpcRenderer = createSafeIpcRenderer(ipcRenderer)
const safeImageBridge = createSafeImageBridge({clipboard, nativeImage})
const rendererLogger = createRendererLogger(ipcRenderer, LOGGER_COMMAND)

expose('ipcRenderer', safeIpcRenderer)
expose('openExternal', (url) => openExternalUrl(shell, url, rendererLogger))
expose(
  'flipStore',
  exposeMethods(flips, [
    'getFlips',
    'getFlip',
    'saveFlips',
    'addDraft',
    'updateDraft',
    'deleteDraft',
    'clear',
  ])
)
expose(
  'invitesDb',
  exposeMethods(invites, [
    'getInvites',
    'getInvite',
    'addInvite',
    'updateInvite',
    'removeInvite',
    'clearInvites',
    'getActivationTx',
    'setActivationTx',
    'clearActivationTx',
    'getActivationCode',
    'setActivationCode',
    'clearActivationCode',
  ])
)
expose('logger', rendererLogger)
expose('isDev', isDev)
expose('isTest', process.env.NODE_ENV === 'e2e')
expose('isMac', process.platform === 'darwin')
expose(
  'clipboard',
  Object.freeze({
    readText: safeImageBridge.readText,
    readImageDataURL: safeImageBridge.readImageDataURL,
    writeImageDataURL: safeImageBridge.writeImageDataURL,
  })
)
expose(
  'image',
  Object.freeze({
    resizeDataURL: safeImageBridge.resizeDataURL,
    resizeDataURLExact: safeImageBridge.resizeDataURLExact,
  })
)
expose('locale', locale)
expose('getZoomLevel', () => webFrame.getZoomLevel())
expose('setZoomLevel', (level) => webFrame.setZoomLevel(level))
expose('appVersion', appInfo.version || '0.0.0')
expose(
  'env',
  Object.freeze({
    NODE_ENV: process.env.NODE_ENV ?? null,
    NODE_MOCK: process.env.NODE_MOCK ?? null,
    BUMP_EXTRA_FLIPS: process.env.BUMP_EXTRA_FLIPS ?? null,
    FINALIZE_FLIPS: process.env.FINALIZE_FLIPS ?? null,
    FINALIZE_LONG_FLIPS: process.env.FINALIZE_LONG_FLIPS ?? null,
    FINALIZE_ALL_LONG_FLIPS: process.env.FINALIZE_ALL_LONG_FLIPS ?? null,
    // A test network's idena.social contract: <address>@<first block> (screens/social/contract.js).
    IDENA_SOCIAL_CONTRACT: process.env.IDENA_SOCIAL_CONTRACT ?? null,
  })
)
expose('toggleFullScreen', () => {
  safeIpcRenderer.send(WINDOW_COMMAND, 'toggle-full-screen')
})
expose('persistentState', createPersistentStateBridge(prepareDb))
expose('database', createDatabaseBridge({levelup, leveldown, sub, dbPath}))

if (process.env.IDENA_E2E_SMOKE === '1') {
  const deadline = Date.now() + 15_000
  let navigationStarted = false
  const reportRendererState = () => {
    const root = document.getElementById('__next')
    const logo = document.querySelector('img[alt="Idena logo"]')
    const rendererHydrated =
      document.documentElement.dataset.idenaRendererReady === 'true'
    const packagedStylesLoaded = Array.from(document.styleSheets).some(
      ({href}) => href && href.includes('/static/scrollbars.css')
    )
    if (
      root?.childElementCount > 0 &&
      rendererHydrated &&
      logo?.complete &&
      logo.naturalWidth > 0 &&
      packagedStylesLoaded
    ) {
      if (window.location.pathname === '/home') {
        if (!navigationStarted) {
          const navigationTarget = document.querySelector('a[href="/wallets"]')
          if (!navigationTarget) {
            ipcRenderer.send(
              E2E_SMOKE_EVENT,
              'failed',
              'wallet navigation target is missing'
            )
            return
          }
          navigationStarted = true
          navigationTarget.click()
        }
        setTimeout(reportRendererState, 100)
        return
      }

      if (window.location.pathname !== '/wallets') {
        setTimeout(reportRendererState, 100)
        return
      }

      ipcRenderer.send(
        E2E_SMOKE_EVENT,
        'ready',
        'renderer hydrated with scripts, styles, logo, and navigation'
      )
      return
    }
    if (Date.now() >= deadline) {
      ipcRenderer.send(
        E2E_SMOKE_EVENT,
        'failed',
        `renderer incomplete (root=${Boolean(
          root?.childElementCount
        )}, hydrated=${rendererHydrated}, logo=${Boolean(
          logo?.complete && logo.naturalWidth > 0
        )}, styles=${packagedStylesLoaded}, path=${window.location.pathname})`
      )
      return
    }
    setTimeout(reportRendererState, 100)
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', reportRendererState, {
      once: true,
    })
  } else {
    reportRendererState()
  }
}
