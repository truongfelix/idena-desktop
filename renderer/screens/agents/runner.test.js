import {
  afterEventRun,
  afterHourlyRun,
  eventsAllowed,
  eventsRead,
  afterRun,
  dailyDue,
  hourlyDue,
  isSocialAgent,
  runAgentNow,
  runDue,
  socialState,
  todayAt,
  bothRuns,
  flipsReady,
} from './runner'
import {runSocialAgent} from './social/run'
import {failedLine} from './run-now'

jest.mock('../social/provider', () => ({useSocial: () => null}))
jest.mock('./social/run', () => ({
  ...jest.requireActual('./social/run'),
  runSocialAgent: jest.fn(),
}))

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

  test('a Social agent: a Social action not Off', () => {
    const with_ = (actions) => ({actions})
    expect(isSocialAgent(with_({reply: {level: 'ask'}}))).toBe(true)
    expect(isSocialAgent(with_({post: {level: 'alone'}}))).toBe(true)
    expect(isSocialAgent(with_({reply: {level: 'off'}}))).toBe(false)
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

  test('an event runs it only for what it reads, and stops for the day after 3 failed event runs', () => {
    const agent = (reads) => ({
      reads,
      events: ['like', 'tip', 'message'],
    })
    expect(eventsRead(agent({notifications: true, messages: false}))).toEqual([
      'like',
      'tip',
    ])
    expect(eventsRead(agent({notifications: false, messages: true}))).toEqual([
      'message',
    ])
    let fails
    expect(eventsAllowed(fails, DAY)).toBe(true)
    fails = afterEventRun(fails, DAY, 'done')
    fails = afterEventRun(fails, DAY, 'failed')
    fails = afterEventRun(fails, DAY, 'failed')
    expect(eventsAllowed(fails, DAY)).toBe(true)
    fails = afterEventRun(fails, DAY, 'failed')
    expect(eventsAllowed(fails, DAY)).toBe(false)
    expect(eventsAllowed(fails, 'Sun Nov 15 2026')).toBe(true)
  })

  test('a daily agent runs once a day: a run since its time, before a restart or by Run now, counts (B-274)', () => {
    const daily = {kind: 'daily', time: '09:00'}
    const nine = todayAt(daily, new Date(2026, 10, 16, 12, 0).getTime())
    const noon = nine + 3 * 3600 * 1000
    expect(new Date(nine).getHours()).toBe(9)
    // Never ran, or last ran yesterday or this morning before 09:00: it runs.
    expect(dailyDue(daily, noon, null)).toBe(true)
    expect(dailyDue(daily, noon, nine - 24 * 3600 * 1000)).toBe(true)
    expect(dailyDue(daily, noon, nine - 60 * 1000)).toBe(true)
    // Ran after 09:00 today (the app since restarted, or Run now at 10:00): not again.
    expect(dailyDue(daily, noon, nine)).toBe(false)
    expect(dailyDue(daily, noon, nine + 3600 * 1000)).toBe(false)
    // Before its time: never.
    expect(dailyDue(daily, nine - 60 * 1000, null)).toBe(false)
    // A saved time after now (a clock set ahead once) is not a run.
    expect(dailyDue(daily, noon, noon + 24 * 3600 * 1000)).toBe(true)
  })
})

describe('one run (B-274, B-273)', () => {
  const agent = {
    id: 'aaaaaaaaaaaaaaaa',
    enabled: true,
    actions: {post: {level: 'alone'}},
    schedule: {kind: 'daily', time: '09:00'},
  }
  const social = {feed: [], me: '0x1', profiles: {}, people: {}}
  const t = (text, values = {}) =>
    text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))
  let calls
  beforeEach(() => {
    calls = []
    global.ipcRenderer = {
      invoke: jest.fn(async (channel, command, data) => {
        calls.push([command, data])
        return null
      }),
    }
  })
  afterEach(() => {
    delete global.ipcRenderer
  })

  test("the run is told what started it; a daily agent's run that read counts from its start, a failed one not", async () => {
    let started
    runSocialAgent.mockImplementationOnce(async (_, __, deps) => {
      started = deps.why
      return {result: 'done', detail: ''}
    })
    const before = Date.now()
    await runAgentNow(agent, social, t)
    expect(started).toBe('now')
    expect(calls).toEqual([
      ['setLastRun', {agentId: agent.id, at: expect.any(Number)}],
    ])
    expect(calls[0][1].at).toBeGreaterThanOrEqual(before)
    calls = []
    runSocialAgent.mockResolvedValueOnce({result: 'nothing new', detail: ''})
    await runAgentNow(agent, social, t, 'daily')
    expect(calls.map(([command]) => command)).toEqual(['setLastRun'])
    calls = []
    runSocialAgent.mockRejectedValueOnce(new Error('the answer was cut short'))
    await expect(runAgentNow(agent, social, t, 'event')).rejects.toThrow(
      'cut short'
    )
    expect(calls).toEqual([])
    // An hourly agent never reads it: nothing written.
    runSocialAgent.mockResolvedValueOnce({result: 'done', detail: ''})
    await runAgentNow(
      {...agent, schedule: {kind: 'hourly'}},
      social,
      t,
      'hourly'
    )
    expect(calls).toEqual([])
  })

  test("the message after a failed Run now holds the reason alone, without Electron's wrapping", () => {
    const error = new Error(
      "Error invoking remote method 'agent': Error: the answer was cut short (the longest answer is 50 tokens)"
    )
    expect(failedLine(error, t)).toBe(
      'It failed: the answer was cut short (the longest answer is 50 tokens)'
    )
  })
})

// B-258: a Flips run reads the identity and the epoch: before they come, it is not run (it would find nothing to do,
// and an hourly agent would then wait an hour).
describe('a Flips run waits for the identity and the epoch', () => {
  test('ready only with both', () => {
    const identity = {address: '0x1', state: 'Human'}
    const epoch = {currentPeriod: 'None'}
    expect(flipsReady({identity, epoch})).toBe(true)
    expect(flipsReady({identity: null, epoch})).toBe(false)
    expect(flipsReady({identity: {}, epoch})).toBe(false)
    expect(flipsReady({identity, epoch: null})).toBe(false)
  })

  test('two areas run: a failure first, else what they did', () => {
    const done = (detail) => ({result: 'done', detail})
    expect(bothRuns(done('a'), done('b'))).toEqual(done('a · b'))
    expect(bothRuns({result: 'failed', detail: 'x'}, done('b'))).toEqual({
      result: 'failed',
      detail: 'x',
    })
    expect(bothRuns(null, {result: 'nothing new', detail: ''})).toEqual({
      result: 'nothing new',
      detail: '',
    })
    expect(bothRuns(null, null)).toEqual({result: 'off', detail: ''})
  })
})
