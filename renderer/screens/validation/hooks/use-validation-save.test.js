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
  function setup({saveMs = 0} = {}) {
    let clock = 0
    const timers = []
    const saved = []
    const saver = createSaver({
      save: (state) => {
        saved.push(state)
        // The disk's time: the thread waits for it.
        clock += saveMs
      },
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
      const until = clock + ms
      for (;;) {
        const due = timers
          .filter((timer) => timer.at <= until)
          .sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        clock = Math.max(clock, due.at)
        due.fn()
      }
      clock = Math.max(clock, until)
    }
    return {saver, saved, advance}
  }

  it('never saves at the moment of a change: the last of a burst, then one interval after', () => {
    const {saver, saved, advance} = setup()
    saver.push('a')
    saver.push('b')
    expect(saved).toEqual([])
    advance(0)
    expect(saved).toEqual(['b'])
    saver.push('c')
    saver.push('d')
    expect(saved).toEqual(['b'])
    advance(SAVE_INTERVAL_MS - 1)
    expect(saved).toEqual(['b'])
    advance(1)
    expect(saved).toEqual(['b', 'd'])
    advance(SAVE_INTERVAL_MS * 3)
    expect(saved).toEqual(['b', 'd'])
  })

  it('counts the interval from the end of a slow save: a change after it waits', () => {
    const {saver, saved, advance} = setup({saveMs: 3000})
    saver.push('a')
    advance(0)
    expect(saved).toEqual(['a'])
    // Long after the save began, right after it ended: the change is not written at the tap.
    saver.push('b')
    expect(saved).toEqual(['a'])
    advance(SAVE_INTERVAL_MS - 1)
    expect(saved).toEqual(['a'])
    advance(1)
    expect(saved).toEqual(['a', 'b'])
  })

  it('saves an urgent change at once, the one waiting with it', () => {
    const {saver, saved, advance} = setup()
    saver.push('a')
    saver.push('submitting', true)
    expect(saved).toEqual(['submitting'])
    advance(SAVE_INTERVAL_MS * 2)
    expect(saved).toEqual(['submitting'])
  })

  it('writes what waits on flush, and nothing twice', () => {
    const {saver, saved, advance} = setup()
    saver.push('a')
    saver.flush()
    expect(saved).toEqual(['a'])
    saver.flush()
    advance(SAVE_INTERVAL_MS * 2)
    expect(saved).toEqual(['a'])
  })
})
