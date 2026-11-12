import {AnswerType} from '../../../shared/types'
import {
  TEST_FLIP_TIMEOUT_MS,
  agentFlip,
  answerType,
  runPracticeTest,
} from './practice-test'

const flip = (hash, answer, reportReason = 0) => ({
  hash,
  images: ['a', 'b', 'c', 'd'],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  answer,
  reportReason,
  words: [{id: `${hash}-0`, name: 'sign', desc: 'omen'}],
})

describe('the practice test of Settings › Agent', () => {
  test('left is the first order', () => {
    expect(answerType('left')).toBe(AnswerType.Left)
    expect(answerType('right')).toBe(AnswerType.Right)
    expect(answerType(null)).toBe(AnswerType.None)
  })

  test('keywords only in the long session, without their ids', () => {
    const f = flip('x', AnswerType.Left)
    expect(agentFlip(f, {withWords: false}).words).toEqual([])
    expect(agentFlip(f, {withWords: true}).words).toEqual([
      {name: 'sign', desc: 'omen'},
    ])
  })

  test('counts stories, reports and failures as the validation would', async () => {
    const practice = {
      short: [flip('s1', AnswerType.Left), flip('s2', AnswerType.Right)],
      long: [
        flip('l1', AnswerType.Left),
        flip('l2', AnswerType.Right, 1),
        flip('l3', AnswerType.Left, 2),
        flip('l4', AnswerType.Left),
      ],
    }
    const answers = {
      s1: {answer: 'left'},
      s2: {answer: 'left'},
      l1: {answer: 'left', report: true},
      l2: {answer: 'right', report: true},
      l3: {answer: 'left', report: false},
    }
    let clock = 0
    const testFlip = jest.fn(async (sent, timeoutMs) => {
      expect(timeoutMs).toBe(TEST_FLIP_TIMEOUT_MS)
      clock += 2000
      const hash = ['s1', 's2', 'l1', 'l2', 'l3', 'l4'][
        testFlip.mock.calls.length - 1
      ]
      if (!answers[hash]) throw new Error('no answer before the deadline')
      return answers[hash]
    })
    const progress = []
    const result = await runPracticeTest(practice, {
      testFlip,
      now: () => clock,
      onProgress: (done) => progress.push(done),
    })
    expect(result).toMatchObject({
      right: 2,
      total: 4,
      reportsRight: 1,
      reportsWrong: 1,
      reportsMissed: 1,
      failed: 1,
      seconds: 2,
    })
    expect(result.lastError.message).toMatch(/deadline/u)
    expect(progress).toEqual([1, 2, 3, 4, 5, 6])
  })

  test('stops between two flips when asked', async () => {
    let stopped = false
    const testFlip = jest.fn(async () => {
      stopped = true
      return {answer: 'left'}
    })
    await runPracticeTest(
      {short: [flip('a', 1), flip('b', 1)], long: []},
      {testFlip, isStopped: () => stopped}
    )
    expect(testFlip).toHaveBeenCalledTimes(1)
  })
})
