import {AnswerType, RelevanceType} from '../../../shared/types'
import {
  answersToTake,
  autopilotEvents,
  flipDeadlineMs,
  nextFlipToAsk,
  sessionEnd,
  SHORT_FLIP_MAX_MS,
} from './picks'

const flip = (hash, more = {}) => ({
  hash,
  decoded: true,
  images: ['blob:1', 'blob:2', 'blob:3', 'blob:4'],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  ...more,
})
const words = [{id: 1, name: 'sign', desc: 'omen'}]

describe('the agent in a validation', () => {
  test('a flip gets the time left shared by the flips left, at most its cap', () => {
    const end = sessionEnd({
      isShort: true,
      validationStart: 0,
      shortSessionDuration: 120,
      longSessionDuration: 540,
    })
    expect(end).toBe(110000)
    expect(flipDeadlineMs({end, now: 0, flipsLeft: 3, isShort: true})).toBe(
      SHORT_FLIP_MAX_MS
    )
    expect(flipDeadlineMs({end, now: 0, flipsLeft: 6, isShort: true})).toBe(
      17500
    )
    expect(flipDeadlineMs({end, now: 95000, flipsLeft: 2, isShort: true})).toBe(
      5000
    )
    expect(
      flipDeadlineMs({end, now: 104000, flipsLeft: 1, isShort: true})
    ).toBeNull()
    expect(
      sessionEnd({
        isShort: false,
        validationStart: 0,
        shortSessionDuration: 120,
        longSessionDuration: 540,
      })
    ).toBe(650000)
  })

  test('the next flip is the first one shown, read, not asked; long ones need their keywords', () => {
    const flips = [
      flip('a'),
      flip('b', {decoded: false}),
      flip('c', {failed: true}),
      flip('d'),
    ]
    expect(nextFlipToAsk(flips, new Set(), {isShort: true}).hash).toBe('a')
    expect(nextFlipToAsk(flips, new Set(['a']), {isShort: true}).hash).toBe('d')
    expect(nextFlipToAsk(flips, new Set(), {isShort: false})).toBeUndefined()
    expect(
      nextFlipToAsk([flip('e', {words})], new Set(), {isShort: false}).hash
    ).toBe('e')
  })

  test("taking the agent's picks answers only the flips without an answer", () => {
    const flips = [
      flip('a'),
      flip('b', {option: AnswerType.Right}),
      flip('c'),
      flip('d'),
    ]
    const picks = {
      a: {answer: 'left'},
      b: {answer: 'left'},
      c: {answer: null},
      d: {failed: true},
    }
    expect(answersToTake(flips, picks)).toEqual([
      {type: 'ANSWER', hash: 'a', option: AnswerType.Left},
    ])
  })

  test('Autopilot answers once, never over the person, and marks only what it may alone', () => {
    const flips = [
      flip('a'),
      flip('b', {option: AnswerType.Left}),
      flip('c'),
      flip('d', {relevance: RelevanceType.Relevant}),
      flip('e'),
      flip('f'),
    ]
    const picks = {
      a: {decision: 'alone', answer: 'right', relevance: 'relevant'},
      b: {decision: 'alone', answer: 'right'},
      c: {decision: 'ask', answer: 'left'},
      d: {
        decision: 'alone',
        answer: 'left',
        report: true,
        reportDecision: 'alone',
      },
      e: {
        decision: 'alone',
        answer: 'left',
        report: true,
        reportDecision: 'ask',
      },
      f: {
        decision: 'alone',
        answer: 'left',
        report: true,
        reportDecision: 'alone',
      },
    }
    const applied = new Set()
    expect(autopilotEvents({flips, picks, applied, isKeywords: false})).toEqual(
      [
        {type: 'ANSWER', hash: 'a', option: AnswerType.Right},
        {type: 'ANSWER', hash: 'd', option: AnswerType.Left},
        {type: 'ANSWER', hash: 'e', option: AnswerType.Left},
        {type: 'ANSWER', hash: 'f', option: AnswerType.Left},
      ]
    )
    const marks = autopilotEvents({
      flips,
      picks,
      applied: new Set(['answer:a', 'answer:d', 'answer:e', 'answer:f']),
      isKeywords: true,
    })
    expect(marks).toEqual([
      {type: 'APPROVE_WORDS', hash: 'a'},
      {type: 'REPORT_WORDS', hash: 'f'},
    ])
    // A mark it gave once is not given again, even when the person took it back.
    expect(
      autopilotEvents({
        flips,
        picks,
        applied: new Set([
          'answer:a',
          'mark:a',
          'answer:d',
          'answer:e',
          'answer:f',
          'mark:f',
        ]),
        isKeywords: true,
      })
    ).toEqual([])
  })
})
