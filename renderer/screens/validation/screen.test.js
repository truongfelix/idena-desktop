import {EpochPeriod} from '../../shared/types'
import {leavesFailedSubmit, showsSubmitFailed} from './screen'

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

describe('leavesFailedSubmit', () => {
  const failed = stateIn('longSession.solve.answer.submitLongSession.fail')

  it('leaves a submit still failing once the ceremony is over', () => {
    expect(leavesFailedSubmit(failed, EpochPeriod.None)).toBe(true)
  })

  it('stays during the ceremony, and on a submit that did not fail', () => {
    for (const period of [
      EpochPeriod.ShortSession,
      EpochPeriod.LongSession,
      EpochPeriod.AfterLongSession,
    ])
      expect(leavesFailedSubmit(failed, period)).toBe(false)
    expect(
      leavesFailedSubmit(stateIn('validationSucceeded'), EpochPeriod.None)
    ).toBe(false)
  })
})
