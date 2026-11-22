import {AnswerType} from '../../../shared/types'
import {
  KEYWORDS_WAIT_MS,
  SUBMIT_COUNTDOWN_MS,
  SUBMIT_GUARD_MS,
  autopilotPlan,
  fallbackAnswers,
  isSettled,
  nextWakeAt,
} from './autopilot'
import {END_MARGIN_MS, MIN_FLIP_MS} from './picks'
import {secondsLeft} from './submit-countdown'

const flip = (hash, more = {}) => ({
  hash,
  fetched: true,
  decoded: true,
  images: ['blob:1', 'blob:2', 'blob:3', 'blob:4'],
  ...more,
})
const left = () => 0.1
const right = () => 0.9
const answer = (hash, option) => ({type: 'ANSWER', hash, option})

describe('Autopilot through the validation', () => {
  test('a loaded flip the model could not answer gets a random side; one that did not load gets none', () => {
    const flips = [
      flip('waiting'),
      flip('failed', {failed: true}),
      flip('unreadable', {decoded: false}),
      flip('no pictures', {images: []}),
      flip('skipped'),
      flip('timeout'),
      flip('picked'),
      flip('mine', {option: AnswerType.Right}),
    ]
    const picks = {
      skipped: {answer: null},
      timeout: {failed: true},
      picked: {answer: 'right', decision: 'alone'},
      mine: {failed: true},
    }
    expect(fallbackAnswers(flips, picks, {random: left})).toEqual([
      answer('skipped', AnswerType.Left),
      answer('timeout', AnswerType.Left),
    ])
    // Time is up: every loaded flip without an answer, the model's side where it picked one.
    expect(fallbackAnswers(flips, picks, {all: true, random: right})).toEqual([
      answer('waiting', AnswerType.Right),
      answer('skipped', AnswerType.Right),
      answer('timeout', AnswerType.Right),
      answer('picked', AnswerType.Right),
    ])
    // B-257: the reporting agent's side (the answering model failed) is no answer: a random side, as without a pick.
    const reported = {
      picked: {
        answer: null,
        answers: false,
        reportSide: 'right',
        failed: false,
      },
    }
    expect(
      fallbackAnswers([flip('picked')], reported, {all: true, random: left})
    ).toEqual([answer('picked', AnswerType.Left)])
  })

  test('a flip gets one random side, however often it is asked for', () => {
    const drawn = new Map()
    const flips = [flip('a')]
    const picks = {a: {failed: true}}
    const first = fallbackAnswers(flips, picks, {drawn, random: left})
    expect(fallbackAnswers(flips, picks, {drawn, random: right})).toEqual(first)
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

  test('the short session: answered, a countdown, then the submit', () => {
    const flips = [flip('a', {option: AnswerType.Left}), flip('b')]
    const picks = {b: {answer: null}}
    const base = {step: 'short', flips, picks, settled: false, guardAt: 100000}
    const first = autopilotPlan({...base, now: 0, random: left})
    expect(first.events).toEqual([answer('b', AnswerType.Left)])
    expect(first.countdownEnd).toBe(SUBMIT_COUNTDOWN_MS)
    const answered = [flips[0], {...flips[1], option: AnswerType.Left}]
    const at = {...base, flips: answered, countdownEnd: SUBMIT_COUNTDOWN_MS}
    expect(autopilotPlan({...at, now: 10000})).toEqual({
      events: [],
      countdownEnd: SUBMIT_COUNTDOWN_MS,
    })
    expect(autopilotPlan({...at, now: SUBMIT_COUNTDOWN_MS})).toEqual({
      events: [{type: 'SUBMIT'}],
      countdownEnd: null,
    })
  })

  test('a side the model picked counts only once the validation holds it', () => {
    const flips = [flip('a')]
    const picks = {a: {answer: 'left', decision: 'ask'}}
    expect(
      autopilotPlan({
        step: 'short',
        flips,
        picks,
        settled: false,
        now: 0,
        guardAt: 100000,
      })
    ).toEqual({events: [], countdownEnd: null})
    // Nothing left to ask: its side is given, then the countdown runs.
    expect(
      autopilotPlan({
        step: 'short',
        flips,
        picks,
        settled: true,
        now: 0,
        guardAt: 100000,
      }).events
    ).toEqual([answer('a', AnswerType.Left)])
  })

  test('the countdown never runs past the latest submit', () => {
    const flips = [flip('a', {option: AnswerType.Left})]
    const at = {step: 'short', flips, picks: {}, settled: true, guardAt: 100000}
    expect(autopilotPlan({...at, now: 90000}).countdownEnd).toBe(100000)
    expect(autopilotPlan({...at, now: 100000}).events).toEqual([
      {type: 'SUBMIT'},
    ])
  })

  test('a flip still loading waits, until the latest submit; one that failed is skipped', () => {
    const flips = [
      flip('a', {option: AnswerType.Left}),
      flip('b', {fetched: false, decoded: false}),
      flip('c', {failed: true}),
    ]
    const base = {
      step: 'short',
      flips,
      picks: {},
      settled: false,
      guardAt: 100000,
    }
    expect(autopilotPlan({...base, now: 50000})).toEqual({
      events: [],
      countdownEnd: null,
    })
    expect(autopilotPlan({...base, now: 100000}).events).toEqual([
      {type: 'SUBMIT'},
    ])
  })

  test('the long session goes on by itself; it confirms only its own submit', () => {
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
    // No flip at all: it waits, then goes on at the latest submit.
    expect(autopilotPlan({...at, step: 'long'}).events).toEqual([])
    expect(autopilotPlan({...at, step: 'long', now: 100000}).events).toEqual([
      {type: 'FINISH_FLIPS'},
    ])
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
    expect(
      autopilotPlan({...at, step: 'review', didSubmit: true}).events
    ).toEqual([{type: 'SUBMIT'}])
    expect(autopilotPlan({...at, step: 'review'}).events).toEqual([])
    expect(
      autopilotPlan({...at, step: 'shortConfirm', didSubmit: true}).events
    ).toEqual([{type: 'SUBMIT'}])
  })
})

describe("The agent's clock wakes at its deadlines only (B-302)", () => {
  const end = 1_000_000
  // The first moment no time is left: the hook's test is strict.
  const outOfTimeAt = end - END_MARGIN_MS - MIN_FLIP_MS + 1

  it('wakes for nothing when no agent acts', () => {
    expect(nextWakeAt({now: 0, end, isShort: true})).toBeNull()
  })

  it('wakes when no time is left for a question', () => {
    expect(nextWakeAt({now: 0, end, isShort: true, asks: true})).toBe(
      outOfTimeAt
    )
    expect(
      nextWakeAt({now: outOfTimeAt, end, isShort: true, asks: true})
    ).toBeNull()
  })

  it("wakes when a long flip's wait for its keywords ends, not for a flip that has them", () => {
    const seen = new Map([
      ['a', 100],
      ['b', 50],
      ['c', 10],
    ])
    const flips = [
      flip('a'),
      flip('b', {words: [{name: 'x', desc: 'y'}]}),
      flip('c', {decoded: false}),
    ]
    const at = {end, isShort: false, asks: true, flips, seen}
    expect(nextWakeAt({...at, now: 200})).toBe(100 + KEYWORDS_WAIT_MS)
    // The short session waits for no keywords.
    expect(nextWakeAt({...at, isShort: true, now: 200})).toBe(outOfTimeAt)
    // Its wait over: the next deadline.
    expect(nextWakeAt({...at, now: 100 + KEYWORDS_WAIT_MS})).toBe(outOfTimeAt)
  })

  it("wakes Autopilot at its countdown's end, its latest submit and its next try, the first of them", () => {
    const at = {end, isShort: false, autopilot: true}
    const guardAt = end - SUBMIT_GUARD_MS.long
    expect(nextWakeAt({...at, now: 0})).toBe(guardAt)
    expect(nextWakeAt({...at, now: 0, countdownEnd: 30_000})).toBe(30_000)
    expect(
      nextWakeAt({...at, now: 0, countdownEnd: 30_000, retryAt: 5_000})
    ).toBe(5_000)
    expect(nextWakeAt({...at, isShort: true, now: 0})).toBe(
      Math.min(end - SUBMIT_GUARD_MS.short, outOfTimeAt)
    )
    // Past every deadline: no wake.
    expect(nextWakeAt({...at, now: end})).toBeNull()
  })
})

describe('The seconds before Autopilot submits', () => {
  it('counts whole seconds up, never below zero', () => {
    expect(secondsLeft(30_000, 0)).toBe(30)
    expect(secondsLeft(30_000, 100)).toBe(30)
    expect(secondsLeft(30_000, 29_001)).toBe(1)
    expect(secondsLeft(30_000, 31_000)).toBe(0)
  })
})
