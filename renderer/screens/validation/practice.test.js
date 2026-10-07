import fs from 'fs'
import path from 'path'
import {interpret, State} from 'xstate'
import {
  fetchFlipHashes,
  submitShortAnswers,
  submitLongAnswers,
} from '../../shared/api/validation'
import {fetchFlip} from '../../shared/api/dna'
import apiClient from '../../shared/api/api-client'
import {fetchConfirmedKeywordTranslations} from '../flips/utils'
import {AnswerType, FlipGrade, RelevanceType} from '../../shared/types'
import {createValidationMachine} from './machine'
import {
  PRACTICE_LONG_SESSION_DURATION_PER_FLIP,
  PRACTICE_SHORT_SESSION_DURATION,
  createPractice,
  practiceNodeCalls,
  practiceResults,
  practiceServices,
} from './practice'

jest.mock('../../shared/api/validation', () => ({
  fetchFlipHashes: jest.fn(),
  submitShortAnswers: jest.fn(() => Promise.resolve()),
  submitLongAnswers: jest.fn(() => Promise.resolve('0x1')),
}))
jest.mock('../../shared/api/dna', () => ({fetchFlip: jest.fn()}))
jest.mock('../../shared/api/api-client', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('../flips/utils', () => ({
  fetchConfirmedKeywordTranslations: jest.fn(),
}))
jest.mock('../../shared/utils/utils', () => ({loadKeyword: jest.fn()}))

const sample = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'static', 'practice-flips.json'),
    'utf8'
  )
)

// Lets the promises behind the machine's services settle between timer steps.
async function settle() {
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

async function advance(ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    jest.advanceTimersByTime(1000)
    // eslint-disable-next-line no-await-in-loop
    await settle()
  }
}

function startPractice(practice) {
  const machine = createValidationMachine({
    epoch: 0,
    validationStart: Date.now(),
    shortSessionDuration: PRACTICE_SHORT_SESSION_DURATION,
    longSessionDuration:
      practice.long.length * PRACTICE_LONG_SESSION_DURATION_PER_FLIP,
    locale: 'en',
    nodeCalls: practiceNodeCalls(practice),
  }).withConfig({
    services: practiceServices(practice),
    actions: {onExceededReports: jest.fn(), onValidationSucceeded: jest.fn()},
  })
  return interpret(machine, {logger: () => {}}).start()
}

beforeEach(() => {
  jest.useFakeTimers()
  global.env = {}
  jest.clearAllMocks()
  submitShortAnswers.mockImplementation(() => Promise.resolve())
})

afterEach(() => {
  jest.useRealTimers()
})

describe('the sample flips', () => {
  it('hold 6 short and 9 long flips with their answers', () => {
    expect(sample.short).toHaveLength(6)
    expect(sample.long).toHaveLength(9)
    for (const flip of [...sample.short, ...sample.long]) {
      expect(flip.images).toHaveLength(4)
      expect(flip.orders).toHaveLength(2)
      for (const order of flip.orders)
        expect([...order].sort()).toEqual([0, 1, 2, 3])
      expect([AnswerType.Left, AnswerType.Right]).toContain(flip.answer)
      expect(flip.reportReason).toBeGreaterThanOrEqual(0)
      expect(flip.reportReason).toBeLessThanOrEqual(9)
      expect(flip.keywords).toHaveLength(2)
    }
    expect(sample.short.every(({reportReason}) => !reportReason)).toBe(true)
  })
})

describe('createPractice', () => {
  it('keeps the right story on the side its answer names', () => {
    for (const swap of [true, false]) {
      const practice = createPractice(sample, () => (swap ? 0.1 : 0.9))
      for (const flip of [...practice.short, ...practice.long]) {
        const original = [...sample.short, ...sample.long].find(
          (x) => x.hash === flip.hash
        )
        expect(flip.orders[flip.answer - 1]).toEqual(
          original.orders[original.answer - 1]
        )
        expect(flip.answer).toBe(
          swap
            ? AnswerType.Left + AnswerType.Right - original.answer
            : original.answer
        )
      }
    }
  })
})

describe('a practice through the validation machine', () => {
  it('ends with the results and sends nothing to the node', async () => {
    const practice = createPractice(sample)
    const service = startPractice(practice)

    await advance(3000)
    const {shortFlips} = service.state.context
    expect(shortFlips.filter(({decoded}) => decoded)).toHaveLength(6)
    expect(shortFlips[0].images[0]).toMatch(/^blob:/)

    for (const {hash, answer} of practice.short)
      service.send({type: 'ANSWER', hash, option: answer})
    service.send('SUBMIT')
    await settle()
    expect(service.state.matches('longSession')).toBe(true)

    await advance(12000)
    const {longFlips} = service.state.context
    expect(longFlips.filter(({decoded}) => decoded)).toHaveLength(9)
    expect(longFlips.every(({words}) => words?.length === 2)).toBe(true)

    service.send('START_LONG_SESSION')
    for (const {hash, answer} of practice.long)
      service.send({type: 'ANSWER', hash, option: answer})
    service.send('FINISH_FLIPS')
    service.send('START_KEYWORDS_QUALIFICATION')
    // The sample holds 4 flips to report and allows 3 reports: the 4th stays unchecked.
    for (const {hash, reportReason} of practice.long)
      service.send({
        type: reportReason ? 'REPORT_WORDS' : 'APPROVE_WORDS',
        hash,
      })
    const best = practice.long.find(({reportReason}) => !reportReason)
    service.send({type: 'FAVORITE', hash: best.hash})
    service.send('SUBMIT')
    service.send('SUBMIT')
    await settle()

    expect(service.state.matches('validationSucceeded')).toBe(true)

    expect(fetchFlipHashes).not.toHaveBeenCalled()
    expect(fetchFlip).not.toHaveBeenCalled()
    expect(apiClient).not.toHaveBeenCalled()
    expect(fetchConfirmedKeywordTranslations).not.toHaveBeenCalled()
    expect(submitShortAnswers).not.toHaveBeenCalled()
    expect(submitLongAnswers).not.toHaveBeenCalled()

    const results = practiceResults(practice, service.state.context)
    expect(results.short).toEqual({right: 6, total: 6})
    expect(results.long).toEqual({right: 5, total: 5})
    expect(results.reports).toEqual({reported: 3, total: 4, allowed: 3})
    expect(results.longFlips.map(({check}) => check).sort()).toEqual(
      [
        ...Array(5).fill('approved'),
        ...Array(3).fill('reported'),
        'shouldReport',
      ].sort()
    )
    expect(results.longFlips.filter(({isBest}) => isBest)).toEqual([
      expect.objectContaining({hash: best.hash, story: 'right'}),
    ])
  })

  it('fails when the short session ends with too few answers', async () => {
    const practice = createPractice(sample)
    const service = startPractice(practice)

    await advance(3000)
    service.send({
      type: 'ANSWER',
      hash: practice.short[0].hash,
      option: practice.short[0].answer,
    })
    await advance(PRACTICE_SHORT_SESSION_DURATION * 1000)

    expect(service.state.matches('validationFailed')).toBe(true)
    expect(submitShortAnswers).not.toHaveBeenCalled()
  })
})

describe('practiceResults', () => {
  it('counts the stories and the checks', () => {
    const practice = createPractice(sample, () => 0.9)
    const [good, other] = practice.long.filter(
      ({reportReason}) => !reportReason
    )
    const [bad] = practice.long.filter(({reportReason}) => reportReason)
    const wrong = (answer) =>
      answer === AnswerType.Left ? AnswerType.Right : AnswerType.Left

    const results = practiceResults(practice, {
      shortFlips: [
        {hash: practice.short[0].hash, option: practice.short[0].answer},
        {hash: practice.short[1].hash, option: wrong(practice.short[1].answer)},
      ],
      longFlips: [
        {
          hash: good.hash,
          option: good.answer,
          relevance: RelevanceType.Relevant,
        },
        {
          hash: other.hash,
          option: wrong(other.answer),
          relevance: RelevanceType.Irrelevant,
        },
        {hash: bad.hash, option: bad.answer, relevance: RelevanceType.Relevant},
      ],
      bestFlipHashes: {[good.hash]: true},
    })

    expect(results.short).toEqual({right: 1, total: 6})
    expect(results.long).toEqual({right: 1, total: 5})
    expect(results.reports).toEqual({reported: 0, total: 4, allowed: 3})
    const byHash = (hash) => results.longFlips.find((x) => x.hash === hash)
    expect(byHash(good.hash)).toMatchObject({
      story: 'right',
      check: 'approved',
      isBest: true,
    })
    expect(byHash(other.hash)).toMatchObject({
      story: 'wrong',
      check: 'shouldApprove',
    })
    expect(byHash(bad.hash)).toMatchObject({
      story: null,
      check: 'shouldReport',
      reportReason: bad.reportReason,
    })
    const unanswered = practice.long.find(
      ({hash, reportReason}) =>
        !reportReason && ![good.hash, other.hash].includes(hash)
    )
    expect(byHash(unanswered.hash)).toMatchObject({
      story: 'none',
      check: 'notChecked',
    })
  })
})

describe('the validation machine with its own node calls', () => {
  function startValidation(practice) {
    const machine = createValidationMachine({
      epoch: 229,
      validationStart: Date.now(),
      shortSessionDuration: PRACTICE_SHORT_SESSION_DURATION,
      longSessionDuration: 1800,
      locale: 'en',
    }).withConfig({
      services: practiceServices(practice),
      actions: {onExceededReports: jest.fn(), onValidationSucceeded: jest.fn()},
    })
    return interpret(machine, {logger: () => {}})
  }

  async function submitShortSession(service, practice) {
    await advance(3000)
    for (const {hash, answer} of practice.short)
      service.send({type: 'ANSWER', hash, option: answer})
    service.send('SUBMIT')
    await settle()
  }

  it('submits the answers and grades to the node', async () => {
    const practice = createPractice(sample)
    const service = startValidation(practice).start()

    await submitShortSession(service, practice)
    expect(submitShortAnswers).toHaveBeenCalledWith(
      practice.short.map(({hash, answer}) => ({answer, hash})),
      0,
      229
    )

    await advance(12000)
    service.send('START_LONG_SESSION')
    for (const {hash, answer} of practice.long)
      service.send({type: 'ANSWER', hash, option: answer})
    service.send('FINISH_FLIPS')
    service.send('START_KEYWORDS_QUALIFICATION')
    for (const {hash, reportReason} of practice.long)
      service.send({
        type: reportReason ? 'REPORT_WORDS' : 'APPROVE_WORDS',
        hash,
      })
    const best = practice.long.find(({reportReason}) => !reportReason)
    service.send({type: 'FAVORITE', hash: best.hash})
    service.send('SUBMIT')
    service.send('SUBMIT')
    await settle()

    expect(service.state.matches('validationSucceeded')).toBe(true)
    // The 4th flip to report finds no report left: it goes without a grade.
    const reported = practice.long
      .filter(({reportReason}) => reportReason)
      .slice(0, 3)
      .map(({hash}) => hash)
    expect(submitLongAnswers).toHaveBeenCalledWith(
      practice.long.map(({hash, answer, reportReason}) => {
        let grade = FlipGrade.GradeD
        if (hash === best.hash) grade = FlipGrade.GradeA
        else if (reported.includes(hash)) grade = FlipGrade.Reported
        else if (reportReason) grade = FlipGrade.None
        return {answer, grade, hash}
      }),
      0,
      229
    )
    service.stop()
  })

  it('resumes a submit from the saved validation', async () => {
    submitShortAnswers.mockImplementation(() => new Promise(() => {}))
    const practice = createPractice(sample)
    const service = startValidation(practice).start()
    await submitShortSession(service, practice)
    expect(submitShortAnswers).toHaveBeenCalledTimes(1)

    // As persistValidationState saves it: the submit is named by its place in the machine, as before the
    // practice, so another version of the app resumes it too.
    const saved = JSON.parse(JSON.stringify(service.state))
    service.stop()
    expect(
      saved.actions
        .filter(({type}) => type === 'xstate.start')
        .map(({activity}) => activity.src.type)
    ).toEqual([
      'validation.shortSession.solve.answer.submitShortSession.submitting:invocation[0]',
    ])

    const restored = startValidation(practice).start(State.create(saved))
    expect(
      restored.state.matches(
        'shortSession.solve.answer.submitShortSession.submitting'
      )
    ).toBe(true)
    expect(submitShortAnswers).toHaveBeenCalledTimes(2)
    restored.stop()
  })
})
