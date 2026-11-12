import {AnswerType} from '../../../shared/types'
import {
  SUBMIT_COUNTDOWN_MS,
  autopilotPlan,
  isSettled,
  randomAnswers,
} from './autopilot'

const flip = (hash, more = {}) => ({
  hash,
  fetched: true,
  decoded: true,
  ...more,
})
const left = () => 0.1
const right = () => 0.9

describe('Autopilot through the validation', () => {
  test('a flip it cannot answer gets a random side, the others wait for the model', () => {
    const flips = [
      flip('read'),
      flip('failed', {failed: true}),
      flip('unreadable', {decoded: false}),
      flip('skipped'),
      flip('timeout'),
      flip('mine', {option: AnswerType.Right}),
    ]
    const picks = {
      skipped: {answer: null},
      timeout: {failed: true},
      mine: {failed: true},
    }
    expect(randomAnswers(flips, picks, {random: left})).toEqual(
      ['failed', 'unreadable', 'skipped', 'timeout'].map((hash) => ({
        type: 'ANSWER',
        hash,
        option: AnswerType.Left,
      }))
    )
    // A side the model picked is never replaced, even before its answer shows on the flip.
    expect(
      randomAnswers([flip('picked')], {picked: {answer: 'left'}}, {all: true})
    ).toEqual([])
    // Out of time: every flip without an answer, never over the person's.
    expect(
      randomAnswers(flips, picks, {all: true, random: right}).map(
        ({hash}) => hash
      )
    ).toEqual(['read', 'failed', 'unreadable', 'skipped', 'timeout'])
  })

  test('settled only when nothing is asked and nothing is left to ask', () => {
    const flips = [
      flip('a'),
      flip('b', {failed: true}),
      flip('c', {fetched: false, decoded: false}),
    ]
    expect(isSettled(flips, new Set(['a']), {asking: null})).toBe(false)
    expect(isSettled(flips, new Set(['a', 'c']), {asking: 'short:c'})).toBe(
      false
    )
    expect(isSettled(flips, new Set(['a', 'c']), {asking: null})).toBe(true)
    expect(isSettled(flips, new Set(), {asking: null, outOfTime: true})).toBe(
      true
    )
  })

  test('the short session: answered, then a countdown, then the submit', () => {
    const flips = [flip('a', {option: AnswerType.Left}), flip('b')]
    const picks = {b: {answer: null}}
    const base = {
      step: 'short',
      flips,
      picks,
      settled: false,
      guardAt: 100000,
      random: left,
    }
    const first = autopilotPlan({...base, now: 0})
    expect(first.events).toEqual([
      {type: 'ANSWER', hash: 'b', option: AnswerType.Left},
    ])
    expect(first.countdownEnd).toBe(SUBMIT_COUNTDOWN_MS)
    const answered = [flips[0], {...flips[1], option: AnswerType.Left}]
    expect(
      autopilotPlan({
        ...base,
        flips: answered,
        now: 10000,
        countdownEnd: SUBMIT_COUNTDOWN_MS,
      })
    ).toEqual({events: [], countdownEnd: SUBMIT_COUNTDOWN_MS})
    expect(
      autopilotPlan({
        ...base,
        flips: answered,
        now: SUBMIT_COUNTDOWN_MS,
        countdownEnd: SUBMIT_COUNTDOWN_MS,
      })
    ).toEqual({events: [{type: 'SUBMIT'}], countdownEnd: null})
  })

  test('the countdown never runs past the latest submit', () => {
    const flips = [flip('a', {option: AnswerType.Left})]
    expect(
      autopilotPlan({
        step: 'short',
        flips,
        picks: {},
        settled: true,
        now: 90000,
        guardAt: 100000,
      }).countdownEnd
    ).toBe(100000)
    expect(
      autopilotPlan({
        step: 'short',
        flips,
        picks: {},
        settled: true,
        now: 100000,
        guardAt: 100000,
      }).events
    ).toEqual([{type: 'SUBMIT'}])
  })

  test('a flip still on its way waits, until the latest submit: then everything is answered and sent', () => {
    const flips = [
      flip('a', {option: AnswerType.Left}),
      flip('b', {fetched: false, decoded: false}),
    ]
    const base = {
      step: 'short',
      flips,
      picks: {},
      settled: false,
      guardAt: 100000,
      random: right,
    }
    expect(autopilotPlan({...base, now: 50000})).toEqual({
      events: [],
      countdownEnd: null,
    })
    expect(autopilotPlan({...base, now: 100000}).events).toEqual([
      {type: 'ANSWER', hash: 'b', option: AnswerType.Right},
      {type: 'SUBMIT'},
    ])
  })

  test('the long session goes on by itself: start, flips, keywords, submit, confirm', () => {
    const at = {flips: [], picks: {}, settled: false, now: 0, guardAt: 100000}
    expect(autopilotPlan({...at, step: 'welcome'}).events).toEqual([
      {type: 'START_LONG_SESSION'},
    ])
    expect(
      autopilotPlan({
        ...at,
        step: 'long',
        flips: [flip('a', {option: AnswerType.Left})],
      }).events
    ).toEqual([{type: 'FINISH_FLIPS'}])
    expect(autopilotPlan({...at, step: 'finish'}).events).toEqual([
      {type: 'START_KEYWORDS_QUALIFICATION'},
    ])
    expect(autopilotPlan({...at, step: 'keywords'})).toEqual({
      events: [],
      countdownEnd: null,
    })
    expect(
      autopilotPlan({...at, step: 'keywords', settled: true}).countdownEnd
    ).toBe(SUBMIT_COUNTDOWN_MS)
    expect(autopilotPlan({...at, step: 'review'}).events).toEqual([
      {type: 'SUBMIT'},
    ])
    expect(autopilotPlan({...at, step: 'shortConfirm'}).events).toEqual([
      {type: 'SUBMIT'},
    ])
  })
})
