import {
  ERROR_RETRY_MS,
  MAX_IPFS_READS,
  MISSING_RETRY_MS,
  limitedRunner,
} from './hooks'

jest.mock('./node', () => ({
  ...jest.requireActual('./node'),
  socialRpc: jest.fn(),
}))

/** A task that ends when `release()` is called. */
function heldTask(value) {
  let release
  const done = new Promise((resolve) => {
    release = () => resolve(value)
  })
  const task = jest.fn(() => done)
  return {task, release: () => release()}
}

describe('limitedRunner', () => {
  it('runs at most its limit at once, the others in the order they came', async () => {
    const run = limitedRunner(MAX_IPFS_READS)
    const tasks = Array.from({length: MAX_IPFS_READS + 2}, (_, i) =>
      heldTask(i)
    )
    const results = tasks.map(({task}) => run(task))
    await Promise.resolve()
    await Promise.resolve()

    const started = () => tasks.filter(({task}) => task.mock.calls.length)
    expect(started()).toHaveLength(MAX_IPFS_READS)
    expect(tasks[MAX_IPFS_READS].task).not.toHaveBeenCalled()

    tasks[1].release()
    await results[1]
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    expect(started()).toHaveLength(MAX_IPFS_READS + 1)
    expect(tasks[MAX_IPFS_READS].task).toHaveBeenCalled()
    expect(tasks[MAX_IPFS_READS + 1].task).not.toHaveBeenCalled()

    tasks.forEach(({release}) => release())
    await expect(Promise.all(results)).resolves.toEqual(tasks.map((_, i) => i))
  })

  it('goes on after a task that failed', async () => {
    const run = limitedRunner(1)
    const failed = run(() => Promise.reject(new Error('no')))
    const next = run(() => 'yes')
    await expect(failed).rejects.toThrow('no')
    await expect(next).resolves.toBe('yes')
  })
})

/**
 * react-query and hooks.js loaded as in the window: without a `window`, react-query takes jest for a server and
 * never starts a refetchInterval (its utils' isServer, read once when it loads). The window stays for this file's
 * tests: react-query reads it again later (its focus manager).
 */
function loadAsInWindow() {
  global.window = global.window || {}
  let loaded
  jest.isolateModules(() => {
    loaded = {
      // eslint-disable-next-line global-require
      ...require('react-query'),
      // eslint-disable-next-line global-require
      ...require('./hooks'),
      // eslint-disable-next-line global-require
      node: require('./node'),
    }
  })
  return loaded
}
const {QueryClient, QueryObserver, ipfsContentQuery, node} = loadAsInWindow()

/** Watches a query as useQuery does; `latest()` is the last result seen. */
function watch(client, query) {
  const observer = new QueryObserver(client, query)
  let latest = observer.getCurrentResult()
  const stop = observer.subscribe((result) => {
    latest = result
  })
  return {latest: () => latest, stop}
}

describe('ipfsContentQuery', () => {
  let client
  beforeEach(() => {
    jest.useFakeTimers()
    client = new QueryClient()
  })
  afterEach(() => {
    client.clear()
    jest.useRealTimers()
  })

  it('does not send a queued read whose view is gone', async () => {
    const held = []
    node.socialRpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          held.push(() => resolve('0x01'))
        })
    )
    const cids = Array.from({length: MAX_IPFS_READS + 1}, (_, i) => `q${i}`)
    const views = cids.map((cid) => watch(client, ipfsContentQuery(cid)))
    await jest.advanceTimersByTimeAsync(100)
    expect(node.socialRpc).toHaveBeenCalledTimes(MAX_IPFS_READS)

    views[MAX_IPFS_READS].stop()
    held.forEach((release) => release())
    await jest.advanceTimersByTimeAsync(100)

    expect(node.socialRpc).toHaveBeenCalledTimes(MAX_IPFS_READS)
    expect(node.socialRpc.mock.calls.map((call) => call[1][0])).not.toContain(
      cids[MAX_IPFS_READS]
    )
    expect(views[0].latest().data).toEqual(new Uint8Array([1]))
    views.slice(0, MAX_IPFS_READS).forEach(({stop}) => stop())
    node.socialRpc.mockReset()
  })

  it('asks again soon after a node that is starting refused the read', async () => {
    let started = false
    const read = jest.fn(async () => {
      if (!started)
        throw new Error('the method ipfs_get does not exist/is not available')
      return '0x0102'
    })
    const {latest, stop} = watch(client, ipfsContentQuery('bafy4', read))

    await jest.advanceTimersByTimeAsync(1000)
    expect(latest().isError).toBe(true)

    started = true
    await jest.advanceTimersByTimeAsync(ERROR_RETRY_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(latest().data).toEqual(new Uint8Array([1, 2]))
    stop()
  })

  it('asks again for content no node had, and shows it once it turns up', async () => {
    let there = false
    const read = jest.fn(async () => {
      if (!there) throw new Error('timeout while reading data from ipfs')
      return '0x0102'
    })
    const {latest, stop} = watch(client, ipfsContentQuery('bafy1', read))

    await jest.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(latest().data).toBeNull()

    there = true
    await jest.advanceTimersByTimeAsync(MISSING_RETRY_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(latest().data).toEqual(new Uint8Array([1, 2]))

    await jest.advanceTimersByTimeAsync(3 * MISSING_RETRY_MS)
    expect(read).toHaveBeenCalledTimes(2)
    stop()
  })

  it("counts the read's own timeout as missing, and keeps any other error an error", async () => {
    const read = jest.fn(async () => {
      throw new Error('ipfs_get: no answer within 130 s')
    })
    const {latest, stop} = watch(client, ipfsContentQuery('bafy2', read))
    await jest.advanceTimersByTimeAsync(1000)
    expect(latest().data).toBeNull()
    stop()

    const other = jest.fn(async () => {
      throw new Error('connection refused')
    })
    const second = watch(client, ipfsContentQuery('bafy3', other))
    await jest.advanceTimersByTimeAsync(1000)
    expect(second.latest().isError).toBe(true)
    second.stop()
  })
})
