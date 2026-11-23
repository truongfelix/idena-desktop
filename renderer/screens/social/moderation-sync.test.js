import {MODERATION_CONTRACT, MODERATION_FIRST_BLOCK} from './moderation'
import {
  MODERATION_RANGE,
  emptyModerationCache,
  readModerationCache,
  syncModeration,
} from './moderation-sync'
import {a, b, hex} from './test-helpers'

const first = MODERATION_FIRST_BLOCK

// A node holding one report call per height of `reports`, its answers as idena-go gives them.
function fakeNode(head, reports, {events = true} = {}) {
  const asked = []
  const call = async (method, [params] = []) => {
    asked.push([method, params])
    if (method === 'bcn_lastBlock') return {height: head}
    if (method === 'bcn_blocksWithAddress')
      return reports.filter((h) => h >= params.from && h <= params.to)
    if (method === 'bcn_contractCalls')
      return params.heights.map((height) => ({
        hash: `0x${String(height).padStart(64, '0')}`,
        height,
        index: 0,
        timestamp: height,
        success: true,
        ...(events && params.events
          ? {
              events: [
                {
                  contract: MODERATION_CONTRACT,
                  event: 'report',
                  args: [a, b, hex(`at ${height}`)],
                },
              ],
            }
          : {}),
      }))
    throw new Error(`unexpected ${method}`)
  }
  return {call, asked}
}

describe('the moderation sync', () => {
  it('reads every block from the contract first one through the head, in ranges', async () => {
    const head = first + MODERATION_RANGE + 20
    const reports = [first, first + 9, first + MODERATION_RANGE + 3]
    const {call, asked} = fakeNode(head, reports)
    const saved = []
    const cache = await syncModeration(emptyModerationCache(), call, (c) =>
      saved.push(c.high)
    )
    expect(cache.high).toBe(head)
    expect(cache.events.map((e) => e.reason)).toEqual(
      reports.map((h) => `at ${h}`)
    )
    expect(saved).toEqual([first + MODERATION_RANGE - 1, head])
    const ranges = asked
      .filter(([m]) => m === 'bcn_blocksWithAddress')
      .map(([, p]) => [p.from, p.to])
    expect(ranges).toEqual([
      [first, first + MODERATION_RANGE - 1],
      [first + MODERATION_RANGE, head],
    ])
  })

  it('goes on from where it stopped, and asks for nothing when up to date', async () => {
    const {call, asked} = fakeNode(first + 5, [first + 5])
    const cache = await syncModeration(
      {...emptyModerationCache(), high: first + 5},
      call
    )
    expect(cache.events).toEqual([])
    expect(asked.map(([m]) => m)).toEqual(['bcn_lastBlock'])
  })

  it('asks nothing more once stopped', async () => {
    const {call, asked} = fakeNode(first + 5, [first + 1])
    const cache = emptyModerationCache()
    expect(
      await syncModeration(
        cache,
        call,
        () => {},
        () => true
      )
    ).toBe(cache)
    expect(asked.map(([m]) => m)).toEqual(['bcn_lastBlock'])
  })

  it('stops on a node that does not return the events', async () => {
    const {call} = fakeNode(first + 5, [first + 1], {events: false})
    const saved = []
    await expect(
      syncModeration(emptyModerationCache(), call, (c) => saved.push(c))
    ).rejects.toThrow('does not return the events')
    expect(saved).toEqual([])
  })

  it('starts again for another contract or version', () => {
    const cache = {...emptyModerationCache(), high: first + 10, events: [{}]}
    expect(readModerationCache(cache)).toBe(cache)
    expect(readModerationCache({...cache, contract: a}).high).toBe(first - 1)
    expect(readModerationCache({...cache, version: 9}).events).toEqual([])
    expect(readModerationCache(null).high).toBe(first - 1)
  })
})
