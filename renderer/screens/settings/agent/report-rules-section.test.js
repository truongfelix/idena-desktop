import {thresholdsSummary} from './report-rules-section'

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))
const of = (...values) =>
  Object.fromEntries(values.map((value, i) => [i + 1, value]))

describe('the thresholds in one line', () => {
  test('the default: reasons 1-4 at 70%, 5-9 at 90%', () => {
    expect(
      thresholdsSummary(of(0.7, 0.7, 0.7, 0.7, 0.9, 0.9, 0.9, 0.9, 0.9), t)
    ).toBe('Reasons 1-4 at 70%, 5-9 at 90%')
  })

  test('all the same, one reason apart, or too many runs', () => {
    expect(thresholdsSummary(of(...Array(9).fill(0.8)), t)).toBe(
      'All reasons at 80%'
    )
    expect(
      thresholdsSummary(of(0.6, 0.7, 0.7, 0.7, 0.9, 0.9, 0.9, 0.9, 0.9), t)
    ).toBe('Reasons 1 at 60%, 2-4 at 70%, 5-9 at 90%')
    expect(
      thresholdsSummary(of(0.6, 0.7, 0.6, 0.7, 0.9, 0.9, 0.9, 0.9, 0.9), t)
    ).toBe('Custom thresholds')
  })

  test('an edit shows in the summary', () => {
    const edited = {...of(0.7, 0.7, 0.7, 0.7, 0.9, 0.9, 0.9, 0.9, 0.9), 9: 1}
    expect(thresholdsSummary(edited, t)).toBe(
      'Reasons 1-4 at 70%, 5-8 at 90%, 9 at 100%'
    )
  })
})
