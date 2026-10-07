const {
  AUTO_UPDATE_COMMAND,
  AUTO_UPDATE_EVENT,
  NODE_COMMAND,
  NODE_EVENT,
  WINDOW_COMMAND,
} = require('./channels')

const SEND_CHANNELS = new Set([
  AUTO_UPDATE_COMMAND,
  NODE_COMMAND,
  WINDOW_COMMAND,
  'confirm-quit',
  'DNA_LINK_HANDLED',
  'reload',
  'showMainWindow',
])

const INVOKE_CHANNELS = new Set(['CHECK_DNA_LINK', 'search-image'])

const LISTEN_CHANNELS = new Set([
  AUTO_UPDATE_EVENT,
  NODE_EVENT,
  'DNA_LINK',
  'confirm-quit',
])

const NODE_COMMANDS = new Set([
  'clean-state',
  'get-last-logs',
  'init-local-node',
  'restart-node',
  'start-local-node',
  'stop-local-node',
  'troubleshooting-reset-node',
  'troubleshooting-restart-node',
  'troubleshooting-update-node',
])

const AUTO_UPDATE_COMMANDS = new Set([
  'start-checking',
  'update-node',
  'update-ui',
])

const WINDOW_COMMANDS = new Set(['toggle-full-screen'])

function assertAllowedChannel(channel, allowedChannels, operation) {
  if (!allowedChannels.has(channel)) {
    throw new Error(`Blocked IPC ${operation} channel: ${channel}`)
  }
}

function assertAllowedCommand(channel, args) {
  const [command] = args

  if (channel === NODE_COMMAND && !NODE_COMMANDS.has(command)) {
    throw new Error(`Blocked node IPC command: ${command}`)
  }

  if (channel === AUTO_UPDATE_COMMAND && !AUTO_UPDATE_COMMANDS.has(command)) {
    throw new Error(`Blocked auto-update IPC command: ${command}`)
  }

  if (channel === WINDOW_COMMAND && !WINDOW_COMMANDS.has(command)) {
    throw new Error(`Blocked window IPC command: ${command}`)
  }
}

function createSafeIpcRenderer(ipcRenderer) {
  const listenerMap = new Map()

  const getWrappedListener = (channel, listener) => {
    let channelListeners = listenerMap.get(channel)
    if (!channelListeners) {
      channelListeners = new WeakMap()
      listenerMap.set(channel, channelListeners)
    }

    let wrappedListener = channelListeners.get(listener)
    if (!wrappedListener) {
      wrappedListener = (_event, ...args) => listener(undefined, ...args)
      channelListeners.set(listener, wrappedListener)
    }

    return wrappedListener
  }

  return {
    send(channel, ...args) {
      assertAllowedChannel(channel, SEND_CHANNELS, 'send')
      assertAllowedCommand(channel, args)
      return ipcRenderer.send(channel, ...args)
    },
    invoke(channel, ...args) {
      assertAllowedChannel(channel, INVOKE_CHANNELS, 'invoke')
      return ipcRenderer.invoke(channel, ...args)
    },
    on(channel, listener) {
      assertAllowedChannel(channel, LISTEN_CHANNELS, 'listen')
      if (typeof listener !== 'function') {
        throw new Error('IPC listener must be a function')
      }
      const wrappedListener = getWrappedListener(channel, listener)
      ipcRenderer.on(channel, wrappedListener)
      // Through the context bridge the renderer's function arrives as a new proxy on every call, so a
      // later removeListener(channel, listener) from the renderer never matches it and listeners pile up.
      // The renderer removes its listener with the function returned here.
      return () => ipcRenderer.removeListener(channel, wrappedListener)
    },
    removeListener(channel, listener) {
      assertAllowedChannel(channel, LISTEN_CHANNELS, 'removeListener')
      const channelListeners = listenerMap.get(channel)
      const wrappedListener = channelListeners?.get(listener)
      if (wrappedListener) {
        ipcRenderer.removeListener(channel, wrappedListener)
      }
    },
  }
}

module.exports = {
  AUTO_UPDATE_COMMANDS,
  INVOKE_CHANNELS,
  LISTEN_CHANNELS,
  NODE_COMMANDS,
  SEND_CHANNELS,
  WINDOW_COMMANDS,
  createSafeIpcRenderer,
}
