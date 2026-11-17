import {QueryClient, QueryObserver} from 'react-query'
import {feedProfilesQuery} from './profile-hooks'

/** How long a node that just started answers only bcn_ calls (B-216's node log: 16 s). */
const START_WINDOW_MS = 16 * 1000

/** A read of the profiles that fails as a starting node does, until `readyAt` (ms of the fake clock). */
function startingNode(readyAt) {
  const read = jest.fn(async (list) => {
    if (Date.now() < readyAt)
      throw new Error(
        'the method contract_readMap does not exist/is not available'
      )
    return Object.fromEntries(
      list.map((address) => [address, {address, name: `n${address}`}])
    )
  })
  return read
}

/** Watches the feed's profiles query as useProfiles does; `latest()` is the last result seen. */
function watch(client, query) {
  const observer = new QueryObserver(client, {...query, enabled: true})
  let latest = observer.getCurrentResult()
  const stop = observer.subscribe((result) => {
    latest = result
  })
  return {latest: () => latest, stop}
}

describe('feedProfilesQuery', () => {
  let client
  beforeEach(() => {
    jest.useFakeTimers()
    client = new QueryClient()
  })
  afterEach(() => {
    client.clear()
    jest.useRealTimers()
  })

  it('reads the profiles once the node answers, after its start window', async () => {
    const read = startingNode(Date.now() + START_WINDOW_MS)
    const {latest, stop} = watch(
      client,
      feedProfilesQuery(['0xa', '0xb'], read)
    )

    await jest.advanceTimersByTimeAsync(START_WINDOW_MS + 60 * 1000)

    expect(read.mock.calls.length).toBeGreaterThan(2)
    expect(latest().data).toEqual({
      '0xa': {address: '0xa', name: 'n0xa'},
      '0xb': {address: '0xb', name: 'n0xb'},
    })
    stop()
  })

  it('waits longer between reads while the node does not answer, at most 30 s', async () => {
    const read = startingNode(Infinity)
    const {stop} = watch(client, feedProfilesQuery(['0xa'], read))

    await jest.advanceTimersByTimeAsync(10 * 60 * 1000)

    // 2, 4, 8, 16 then 30 s: about 23 reads in 10 minutes, never one a second.
    expect(read.mock.calls.length).toBeGreaterThan(15)
    expect(read.mock.calls.length).toBeLessThan(30)
    stop()
  })
})
