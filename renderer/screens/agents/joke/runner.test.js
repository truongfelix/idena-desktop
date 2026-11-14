import {afterRun, runDue} from './runner'

jest.mock('../../social/provider', () => ({useSocial: () => null}))

const DAY = 'Sat Nov 14 2026'
const NOW = 1000000

describe("the agents' runs in the window", () => {
  test('due once a day; a failed run is tried again after 15 minutes, three times at most', () => {
    expect(runDue(undefined, DAY, NOW)).toBe(true)
    let state = afterRun(undefined, DAY, NOW, 'failed')
    expect(runDue(state, DAY, NOW + 60 * 1000)).toBe(false)
    expect(runDue(state, DAY, NOW + 15 * 60 * 1000)).toBe(true)
    state = afterRun(state, DAY, NOW, 'failed')
    state = afterRun(state, DAY, NOW, 'failed')
    expect(runDue(state, DAY, NOW + 3600 * 1000)).toBe(false)
    expect(runDue(state, 'Sun Nov 15 2026', NOW)).toBe(true)
  })

  test('a run that posted, waits or skipped is done for the day', () => {
    for (const result of ['posted', 'ask', 'skipped', 'done today', 'off'])
      expect(
        runDue(afterRun(undefined, DAY, NOW, result), DAY, NOW + 3600 * 1000)
      ).toBe(false)
  })
})
