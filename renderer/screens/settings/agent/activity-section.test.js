import {activityText, formatTime, groupActivity} from './activity-section'

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))

describe('the Activity list (B-252)', () => {
  test('the same line in a row shows once, with its count and the newest time', () => {
    const saved = (at) => ({at, action: 'settings', decision: 'saved'})
    const rows = groupActivity(
      [
        saved(50),
        saved(40),
        saved(30),
        {at: 20, action: 'key', decision: 'saved'},
        saved(10),
      ],
      t
    )
    expect(rows).toEqual([
      {at: 50, text: 'Settings saved', how: '', count: 3},
      {at: 20, text: 'Key saved', how: '', count: 1},
      {at: 10, text: 'Settings saved', how: '', count: 1},
    ])
  })

  test('two answers of different flips stay apart; the same text decided otherwise too', () => {
    const rows = groupActivity(
      [
        {at: 3, action: 'answerFlip', decision: 'alone', detail: 'left'},
        {at: 2, action: 'answerFlip', decision: 'alone', detail: 'right'},
        {at: 1, action: 'answerFlip', decision: 'alone', detail: 'right'},
      ],
      t
    )
    expect(rows.map((r) => [r.text, r.count])).toEqual([
      ['Answered a flip: left', 1],
      ['Answered a flip: right', 2],
    ])
  })

  test('the hour alone today, the date too before', () => {
    const now = new Date(2026, 10, 15, 14, 0).getTime()
    const today = formatTime(new Date(2026, 10, 15, 11, 48).getTime(), now)
    const before = formatTime(new Date(2026, 10, 14, 11, 48).getTime(), now)
    expect(before.length).toBeGreaterThan(today.length)
    expect(before).toContain(today)
  })
})

describe('what started a Social run (B-274)', () => {
  test('each kind in words, and two runs in a row stay two lines apart from their failures', () => {
    expect(activityText({action: 'run', decision: 'now'}, t)).toBe(
      'Run now: a run started by you'
    )
    expect(activityText({action: 'run', decision: 'daily'}, t)).toBe(
      'Daily run: its time of the day came'
    )
    expect(activityText({action: 'run', decision: 'hourly'}, t)).toBe(
      'Hourly run'
    )
    expect(activityText({action: 'run', decision: 'event'}, t)).toBe(
      'Run on an event: a like, an answer, a tip or a message'
    )
    const failed = {action: 'social', decision: 'failed', detail: 'cut short'}
    const rows = groupActivity(
      [
        {at: 4, ...failed},
        {at: 3, action: 'run', decision: 'daily'},
        {at: 2, ...failed},
        {at: 1, action: 'run', decision: 'now'},
      ],
      t
    )
    expect(rows.map((row) => row.count)).toEqual([1, 1, 1, 1])
  })
})
