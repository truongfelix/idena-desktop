import {AnswerType, RelevanceType} from '../../../shared/types'
import {
  answersToTake,
  autopilotEvents,
  flipDeadlineMs,
  flipsLeftToAsk,
  nextFlipToAsk,
  NO_ANSWER_MAX_CHARS,
  noAnswerReason,
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

  test('the time is shared by the flips that can still be asked', () => {
    const flips = [
      flip('a'),
      flip('b', {failed: true}),
      flip('c', {fetched: true, decoded: false}),
      flip('d', {decoded: false}),
    ]
    expect(flipsLeftToAsk(flips, new Set(['a']))).toBe(1)
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
      reportsLeft: 1,
    })
    expect(marks).toEqual([
      {type: 'APPROVE_WORDS', hash: 'a'},
      {type: 'REPORT_WORDS', hash: 'f'},
    ])
    // No report left in the session: the flip it would report is left to the person, not approved.
    expect(
      autopilotEvents({
        flips,
        picks,
        applied: new Set(['answer:a', 'answer:d', 'answer:e', 'answer:f']),
        isKeywords: true,
        reportsLeft: 0,
      })
    ).toEqual([{type: 'APPROVE_WORDS', hash: 'a'}])
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

describe('the validation answered by one agent, reported by another (B-257)', () => {
  const pick = (more) => ({
    decision: 'alone',
    answer: 'left',
    confidence: 0.9,
    relevance: 'relevant',
    report: false,
    reportDecision: 'off',
    ...more,
  })

  test('a reporting agent alone never answers, never fills the answers in; it marks within its own level', () => {
    const picks = {
      a: pick({answers: false, markDecision: 'alone'}),
      b: pick({
        answers: false,
        markDecision: 'alone',
        report: true,
        reportDecision: 'alone',
        relevance: 'irrelevant',
      }),
    }
    const events = autopilotEvents({
      flips: [flip('a'), flip('b')],
      picks,
      applied: new Set(),
      isKeywords: true,
      reportsLeft: 1,
    })
    expect(events).toEqual([
      {type: 'APPROVE_WORDS', hash: 'a'},
      {type: 'REPORT_WORDS', hash: 'b'},
    ])
    expect(answersToTake([flip('a')], picks)).toEqual([])
  })

  test("the marks follow the reporting agent's level, the answer the answering agent's", () => {
    const picks = {a: pick({answers: true, markDecision: 'ask'})}
    const events = autopilotEvents({
      flips: [flip('a')],
      picks,
      applied: new Set(),
      isKeywords: true,
      reportsLeft: 1,
    })
    // Answered alone; the reporting agent asks first: no mark.
    expect(events).toEqual([
      {type: 'ANSWER', hash: 'a', option: expect.anything()},
    ])
  })
})

describe('why the model gave no answer', () => {
  test("the model's error is shown as it came", () => {
    expect(
      noAnswerReason(
        'the model answered HTTP 400: You have reached your specified API usage limits.'
      )
    ).toBe(
      'the model answered HTTP 400: You have reached your specified API usage limits.'
    )
  })

  test('a question stopped by a pause is no failure', () => {
    expect(noAnswerReason('stopped')).toBeNull()
  })

  test('a long error is cut', () => {
    const reason = noAnswerReason(`HTTP 500: ${'x'.repeat(400)}`)
    expect(reason).toHaveLength(NO_ANSWER_MAX_CHARS)
    expect(reason.endsWith('…')).toBe(true)
  })

  test('a long error is cut between characters, never inside an emoji', () => {
    const reason = noAnswerReason(
      `${'x'.repeat(NO_ANSWER_MAX_CHARS - 2)}🙂🙂🙂`
    )
    expect(Array.from(reason)).toHaveLength(NO_ANSWER_MAX_CHARS)
    expect(reason.endsWith('🙂…')).toBe(true)
  })

  test('an error without text is still a failure', () => {
    expect(noAnswerReason(undefined)).toBe('')
  })
})
