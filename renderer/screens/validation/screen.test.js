import {showsSubmitFailed} from './screen'

const stateIn = (value) => ({matches: (path) => path === value})

describe('showsSubmitFailed', () => {
  it('shows a failed submit of either session', () => {
    for (const value of [
      'shortSession.solve.answer.submitShortSession.fail',
      'longSession.solve.answer.submitLongSession.fail',
    ])
      expect(showsSubmitFailed(stateIn(value), false)).toBe(true)
    expect(
      showsSubmitFailed(
        stateIn('longSession.solve.answer.submitLongSession.submitting'),
        false
      )
    ).toBe(false)
  })

  it('hides it while the quit question shows, so it neither retries over it nor takes its focus', () => {
    expect(
      showsSubmitFailed(
        stateIn('longSession.solve.answer.submitLongSession.fail'),
        true
      )
    ).toBe(false)
  })
})
