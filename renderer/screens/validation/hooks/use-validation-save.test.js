import {SAVE_INTERVAL_MS, createSaver, positionOf} from './use-validation-save'

describe('Where the validation stands (B-303)', () => {
  const solving = (nav, fetch = 'done', answer = 'normal') => ({
    shortSession: {fetch, solve: {nav, answer}},
  })

  it('does not change with the flip shown nor the fetching', () => {
    expect(positionOf(solving('firstFlip'))).toBe(positionOf(solving('normal')))
    expect(
      positionOf(solving('lastFlip', {polling: {fetchFlips: 'check'}}))
    ).toBe(positionOf(solving('normal', 'done')))
  })

  it('changes with a submit, a session and the end', () => {
    const now = positionOf(solving('normal'))
    expect(
      positionOf(solving('normal', 'done', {submitShortSession: 'submitting'}))
    ).not.toBe(now)
    expect(
      positionOf({
        longSession: {fetch: 'done', solve: {nav: 'normal', answer: 'flips'}},
      })
    ).not.toBe(now)
    expect(positionOf('validationSucceeded')).not.toBe(now)
  })
})

describe('The validation state saved at most once a second (B-303)', () => {
  function setup() {
    let clock = 0
    const timers = []
    const saved = []
    const saver = createSaver({
      save: (state) => saved.push(state),
      now: () => clock,
      setTimer: (fn, ms) => {
        const timer = {fn, at: clock + ms}
        timers.push(timer)
        return timer
      },
      clearTimer: (timer) => {
        const i = timers.indexOf(timer)
        if (i >= 0) timers.splice(i, 1)
      },
    })
    const advance = (ms) => {
      clock += ms
      timers
        .filter((timer) => timer.at <= clock)
        .forEach((timer) => {
          timers.splice(timers.indexOf(timer), 1)
          timer.fn()
        })
    }
    return {saver, saved, advance}
  }

  it('saves the first change at once, then the last of a burst one interval later', () => {
    const {saver, saved, advance} = setup()
    saver.push('a')
    expect(saved).toEqual(['a'])
    saver.push('b')
    saver.push('c')
    saver.push('d')
    expect(saved).toEqual(['a'])
    advance(SAVE_INTERVAL_MS - 1)
    expect(saved).toEqual(['a'])
    advance(1)
    expect(saved).toEqual(['a', 'd'])
    advance(SAVE_INTERVAL_MS * 3)
    expect(saved).toEqual(['a', 'd'])
  })

  it('saves an urgent change at once, the one waiting with it', () => {
    const {saver, saved, advance} = setup()
    saver.push('a')
    saver.push('b')
    saver.push('submitting', true)
    expect(saved).toEqual(['a', 'submitting'])
    advance(SAVE_INTERVAL_MS * 2)
    expect(saved).toEqual(['a', 'submitting'])
  })

  it('writes what waits on flush, and nothing twice', () => {
    const {saver, saved, advance} = setup()
    saver.push('a')
    saver.push('b')
    saver.flush()
    expect(saved).toEqual(['a', 'b'])
    saver.flush()
    advance(SAVE_INTERVAL_MS * 2)
    expect(saved).toEqual(['a', 'b'])
  })
})
