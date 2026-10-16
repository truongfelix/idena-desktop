import {interpret} from 'xstate'
import {createPeersMachine, PEERS_POLL_MS} from './peers'

// Lets the pending promises of the machine's calls settle.
const settle = () =>
  new Promise((resolve) => {
    jest.requireActual('timers').setImmediate(resolve)
  })

// Runs the machine through `rounds` polls and returns its peers after each one.
async function poll(fetchPeers, rounds) {
  const service = interpret(createPeersMachine(fetchPeers)).start()
  const seen = []
  for (let round = 0; round < rounds; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await settle()
    seen.push(service.state.context.peers.length)
    if (round < rounds - 1) jest.advanceTimersByTime(PEERS_POLL_MS)
  }
  service.stop()
  return seen
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('syncing screen peers', () => {
  it('follows the node after a failed first call', async () => {
    const fetchPeers = jest
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValue([{id: 'a'}, {id: 'b'}])
    expect(await poll(fetchPeers, 3)).toEqual([0, 2, 2])
    expect(fetchPeers).toHaveBeenCalledTimes(3)
  })

  it('keeps the last list when a later call fails', async () => {
    const fetchPeers = jest
      .fn()
      .mockResolvedValueOnce([{id: 'a'}])
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue([])
    expect(await poll(fetchPeers, 3)).toEqual([1, 1, 0])
  })

  it('reads a null answer as no peers', async () => {
    const fetchPeers = jest.fn().mockResolvedValue(null)
    expect(await poll(fetchPeers, 2)).toEqual([0, 0])
  })
})
