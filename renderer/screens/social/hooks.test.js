import {MAX_IPFS_READS, MISSING_RETRY_MS, limitedRunner} from './hooks'

jest.mock('./node', () => ({socialRpc: jest.fn()}))

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
    }
  })
  return loaded
}
const {QueryClient, QueryObserver, ipfsContentQuery} = loadAsInWindow()

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
