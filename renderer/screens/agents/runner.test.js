import {
  afterHourlyRun,
  afterRun,
  hourlyDue,
  isSocialAgent,
  runDue,
  socialState,
} from './runner'

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

  test('an hourly agent runs again an hour after a run, 15 minutes after a failed one', () => {
    expect(hourlyDue(undefined, NOW)).toBe(true)
    const done = afterHourlyRun(NOW, 'done')
    expect(hourlyDue(done, NOW + 59 * 60 * 1000)).toBe(false)
    expect(hourlyDue(done, NOW + 60 * 60 * 1000)).toBe(true)
    expect(hourlyDue(afterHourlyRun(NOW, 'failed'), NOW + 15 * 60 * 1000)).toBe(
      true
    )
  })

  test('a Social agent: no joke task and a Social action not Off', () => {
    const with_ = (actions, task = null) => ({actions, task})
    expect(isSocialAgent(with_({reply: {level: 'ask'}}))).toBe(true)
    expect(isSocialAgent(with_({reply: {level: 'off'}}))).toBe(false)
    expect(isSocialAgent(with_({post: {level: 'alone'}}, 'joke'))).toBe(false)
    expect(isSocialAgent(with_({answerFlip: {level: 'alone'}}))).toBe(false)
  })

  test('a Social run is sent the names claimed in profiles, never the private names given here', () => {
    const state = socialState({
      feed: [],
      me: '0x1',
      profiles: {},
      people: {
        '0xb': {address: '0xb', name: 'Mum', blocked: true},
      },
      names: {'0xb': '@bob · Mum'},
    })
    expect(state.names).toEqual({})
    expect([...state.blocked]).toEqual(['0xb'])
  })
})
