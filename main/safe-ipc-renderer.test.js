const {EventEmitter} = require('events')
const fs = require('fs')
const path = require('path')
const {
  AUTO_UPDATE_COMMAND,
  AUTO_UPDATE_EVENT,
  NODE_COMMAND,
  NODE_EVENT,
} = require('./channels')
const {createSafeIpcRenderer} = require('./safe-ipc-renderer')

function createIpcRendererMock() {
  return {
    invoke: jest.fn().mockResolvedValue('ok'),
    on: jest.fn(),
    removeListener: jest.fn(),
    send: jest.fn(),
  }
}

describe('safe ipcRenderer bridge', () => {
  it('allows expected renderer send channels and commands', () => {
    const ipcRenderer = createIpcRendererMock()
    const safeIpcRenderer = createSafeIpcRenderer(ipcRenderer)

    safeIpcRenderer.send(NODE_COMMAND, 'init-local-node')
    safeIpcRenderer.send(AUTO_UPDATE_COMMAND, 'update-node')
    safeIpcRenderer.send('showMainWindow')

    expect(ipcRenderer.send).toHaveBeenCalledTimes(3)
  })

  it('blocks unexpected send channels and commands', () => {
    const safeIpcRenderer = createSafeIpcRenderer(createIpcRendererMock())

    expect(() => safeIpcRenderer.send('shell', 'open')).toThrow(
      /Blocked IPC send channel/
    )
    expect(() =>
      safeIpcRenderer.send(NODE_COMMAND, 'delete-everything')
    ).toThrow(/Blocked node IPC command/)
    expect(() => safeIpcRenderer.send('set-data', 'idena-bot', true)).toThrow(
      /Blocked IPC send channel/
    )
  })

  it('allows expected invoke channels', async () => {
    const ipcRenderer = createIpcRendererMock()
    const safeIpcRenderer = createSafeIpcRenderer(ipcRenderer)

    await expect(safeIpcRenderer.invoke('search-image', 'cat')).resolves.toBe(
      'ok'
    )

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('search-image', 'cat')
  })

  it('blocks unexpected invoke channels', () => {
    const safeIpcRenderer = createSafeIpcRenderer(createIpcRendererMock())

    expect(() => safeIpcRenderer.invoke('open-file')).toThrow(
      /Blocked IPC invoke channel/
    )
    expect(() => safeIpcRenderer.invoke('get-data', 'idena-bot')).toThrow(
      /Blocked IPC invoke channel/
    )
  })

  it('wraps event listeners without exposing the raw Electron event', () => {
    const ipcRenderer = createIpcRendererMock()
    const safeIpcRenderer = createSafeIpcRenderer(ipcRenderer)
    const listener = jest.fn()

    safeIpcRenderer.on(NODE_EVENT, listener)
    const wrappedListener = ipcRenderer.on.mock.calls[0][1]
    wrappedListener({sender: 'raw'}, 'node-ready', {version: '1.0.0'})

    expect(listener).toHaveBeenCalledWith(undefined, 'node-ready', {
      version: '1.0.0',
    })
  })

  it('removes the wrapped listener for allowed listen channels', () => {
    const ipcRenderer = createIpcRendererMock()
    const safeIpcRenderer = createSafeIpcRenderer(ipcRenderer)
    const listener = jest.fn()

    safeIpcRenderer.on(AUTO_UPDATE_EVENT, listener)
    safeIpcRenderer.removeListener(AUTO_UPDATE_EVENT, listener)

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      AUTO_UPDATE_EVENT,
      ipcRenderer.on.mock.calls[0][1]
    )
  })

  it('removes a listener with the function on() returns', () => {
    const ipcRenderer = new EventEmitter()
    const safeIpcRenderer = createSafeIpcRenderer(ipcRenderer)
    const received = []
    const listener = (_event, ...args) => received.push(args)

    const unsubscribe = safeIpcRenderer.on(NODE_EVENT, listener)
    ipcRenderer.emit(NODE_EVENT, {}, 'node-ready')
    unsubscribe()
    ipcRenderer.emit(NODE_EVENT, {}, 'node-started')

    expect(received).toEqual([['node-ready']])
    expect(ipcRenderer.listenerCount(NODE_EVENT)).toBe(0)
  })

  it('does not pile up listeners re-subscribed through the context bridge', () => {
    // The bridge hands the preload a new proxy of the renderer's function on every call: removeListener
    // with the "same" function finds nothing, the returned unsubscribe does.
    const ipcRenderer = new EventEmitter()
    const safeIpcRenderer = createSafeIpcRenderer(ipcRenderer)
    const listener = jest.fn()
    const bridged =
      () =>
      (...args) =>
        listener(...args)

    for (let render = 0; render < 6; render += 1) {
      const unsubscribe = safeIpcRenderer.on(NODE_EVENT, bridged())
      safeIpcRenderer.removeListener(NODE_EVENT, bridged())
      expect(ipcRenderer.listenerCount(NODE_EVENT)).toBe(1)
      unsubscribe()
    }
    safeIpcRenderer.on(NODE_EVENT, bridged())
    ipcRenderer.emit(NODE_EVENT, {}, 'troubleshooting-restart-node')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('leaves no renderer code removing listeners by function', () => {
    const offenders = []
    const visit = (dir) => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!['.next', 'out', 'node_modules'].includes(entry.name))
            visit(file)
        } else if (
          entry.name.endsWith('.js') &&
          fs.readFileSync(file, 'utf8').includes('ipcRenderer.removeListener(')
        ) {
          offenders.push(path.relative(path.join(__dirname, '..'), file))
        }
      }
    }
    visit(path.join(__dirname, '..', 'renderer'))
    expect(offenders).toEqual([])
  })
})
