const {EventEmitter} = require('events')
const {createNodeProcess} = require('./node-process')

let nextPid = 100

function fakeChild() {
  const child = new EventEmitter()
  nextPid += 1
  child.pid = nextPid
  child.exitCode = null
  child.signalCode = null
  child.exit = (code, signal = null) => {
    child.exitCode = code
    child.signalCode = signal
    child.emit('exit', code, signal)
  }
  return child
}

function setup({exitOn = {SIGINT: 1}, stopTimeoutMs = 50} = {}) {
  const logger = {info: jest.fn(), warn: jest.fn(), error: jest.fn()}
  const onFailed = jest.fn()
  const signals = []
  const signal = jest.fn(async (child, sig) => {
    signals.push([child.pid, sig])
    // idena-go exits with code 1 on SIGINT (its key store's signal handler).
    if (sig in exitOn) setImmediate(() => child.exit(exitOn[sig]))
    if (sig === 'SIGKILL') setImmediate(() => child.exit(null, 'SIGKILL'))
  })
  const nodeProcess = createNodeProcess({
    signal,
    onFailed,
    logger,
    isWindows: false,
    stopTimeoutMs,
    killTimeoutMs: 50,
  })
  return {nodeProcess, onFailed, signals, logger}
}

describe('built-in node process', () => {
  it('starts one node and keeps it on a second start', async () => {
    const {nodeProcess} = setup()
    const child = fakeChild()
    const spawn = jest.fn(async () => child)
    expect(await nodeProcess.start(spawn)).toEqual({child, started: true})
    expect(await nodeProcess.start(spawn)).toEqual({child, started: false})
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(nodeProcess.current).toBe(child)
  })

  it('spawns once for starts sent together', async () => {
    const {nodeProcess} = setup()
    const spawn = jest.fn(async () => fakeChild())
    const results = await Promise.all(
      Array.from({length: 6}, () => nodeProcess.start(spawn))
    )
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(new Set(results.map(({child}) => child)).size).toBe(1)
  })

  it('stops with SIGINT and waits for the exit, without reporting a failure', async () => {
    const {nodeProcess, onFailed, signals} = setup()
    const child = fakeChild()
    await nodeProcess.start(async () => child)
    await nodeProcess.stop()
    expect(signals).toEqual([[child.pid, 'SIGINT']])
    expect(child.exitCode).toBe(1)
    expect(onFailed).not.toHaveBeenCalled()
    expect(nodeProcess.current).toBeNull()
  })

  it('kills a node that does not stop in time', async () => {
    const {nodeProcess, onFailed, signals} = setup({exitOn: {}})
    const child = fakeChild()
    await nodeProcess.start(async () => child)
    await nodeProcess.stop()
    expect(signals).toEqual([
      [child.pid, 'SIGINT'],
      [child.pid, 'SIGKILL'],
    ])
    expect(child.signalCode).toBe('SIGKILL')
    expect(onFailed).not.toHaveBeenCalled()
  })

  it('reports an exit nobody asked for, with a code or a signal', async () => {
    const {nodeProcess, onFailed} = setup()
    const crashed = fakeChild()
    await nodeProcess.start(async () => crashed)
    crashed.exit(2)
    expect(onFailed).toHaveBeenLastCalledWith(
      `node ${crashed.pid} exited with code 2`
    )
    expect(nodeProcess.current).toBeNull()

    const killed = fakeChild()
    await nodeProcess.start(async () => killed)
    killed.exit(null, 'SIGKILL')
    expect(onFailed).toHaveBeenLastCalledWith(
      `node ${killed.pid} exited with code null (SIGKILL)`
    )
    const quiet = fakeChild()
    await nodeProcess.start(async () => quiet)
    quiet.exit(0)
    expect(onFailed).toHaveBeenCalledTimes(3)
  })

  it('starts a new node after the previous one failed', async () => {
    const {nodeProcess} = setup()
    const first = fakeChild()
    await nodeProcess.start(async () => first)
    first.exit(1)
    const second = fakeChild()
    expect(await nodeProcess.start(async () => second)).toEqual({
      child: second,
      started: true,
    })
  })

  it('waits for a stop before starting again', async () => {
    const {nodeProcess} = setup()
    const first = fakeChild()
    await nodeProcess.start(async () => first)
    const stopped = nodeProcess.stop()
    const second = fakeChild()
    const restarted = nodeProcess.start(async () => {
      expect(first.exitCode).toBe(1)
      return second
    })
    await stopped
    expect((await restarted).child).toBe(second)
  })

  it('does nothing on a stop without a node', async () => {
    const {nodeProcess, signals} = setup()
    expect(await nodeProcess.stop()).toBe('node is not running')
    expect(signals).toEqual([])
  })

  it('shares one stop between callers', async () => {
    const {nodeProcess, signals} = setup()
    const child = fakeChild()
    await nodeProcess.start(async () => child)
    await Promise.all([nodeProcess.stop(), nodeProcess.stop()])
    expect(signals).toEqual([[child.pid, 'SIGINT']])
  })

  it('leaves no node after a failed spawn', async () => {
    const {nodeProcess} = setup()
    await expect(
      nodeProcess.start(async () => {
        throw new Error('spawn failed')
      })
    ).rejects.toThrow('spawn failed')
    expect(nodeProcess.current).toBeNull()
    const child = fakeChild()
    expect((await nodeProcess.start(async () => child)).started).toBe(true)
  })
})
