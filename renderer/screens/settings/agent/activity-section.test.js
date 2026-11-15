import {formatTime, groupActivity} from './activity-section'

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
