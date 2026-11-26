import {AnswerType} from '../../../shared/types'

// "Test on the practice flips" (the validation agent's page): the 15 flips of the practice validation, one by one, to the model,
// its answers held against the right ones. Nothing goes to the chain. A flip takes at most the time of a short
// session flip (2 minutes for 6 flips, so 20 s each), as the validation would give it.

export const TEST_FLIP_TIMEOUT_MS = 20 * 1000

/** What the agent channel takes for one practice flip: its pictures, its two orders, its keywords in the long session. */
export function agentFlip(flip, {withWords}) {
  return {
    images: flip.images,
    orders: flip.orders,
    words: withWords ? flip.words.map(({name, desc}) => ({name, desc})) : [],
  }
}

/** The model's side as the validation's answer: left is the first order. */
export function answerType(answer) {
  if (answer === 'left') return AnswerType.Left
  if (answer === 'right') return AnswerType.Right
  return AnswerType.None
}

/**
 * Runs the practice through `testFlip` (the agent channel's testFlip), one flip at a time; `onProgress` gets the
 * count done. Resolves with the stories right (the flips to report do not count, as in the validation), the
 * reports right and wrong, the flips that failed, the average seconds per flip, and `reports`: each long-session flip
 * that is to report or that the model gave a reason for, with its keywords, the right reason, the model's reasons and
 * whether it reported it.
 */
export async function runPracticeTest(
  practice,
  {testFlip, onProgress = () => {}, now = Date.now, isStopped = () => false}
) {
  const flips = [
    ...practice.short.map((flip) => ({flip, withWords: false})),
    ...practice.long.map((flip) => ({flip, withWords: true})),
  ]
  const result = {
    right: 0,
    total: 0,
    reportsRight: 0,
    reportsWrong: 0,
    reportsMissed: 0,
    failed: 0,
    lastError: null,
    seconds: 0,
    reports: [],
  }
  let elapsed = 0
  let done = 0
  for (const {flip, withWords} of flips) {
    if (isStopped()) break
    const start = now()
    let answer = null
    try {
      // One at a time, as a validation shows them.
      // eslint-disable-next-line no-await-in-loop
      answer = await testFlip(
        agentFlip(flip, {withWords}),
        TEST_FLIP_TIMEOUT_MS
      )
    } catch (error) {
      // Stopped by the user: the flip in flight was never answered, it does not count.
      if (isStopped()) break
      result.failed += 1
      result.lastError = error
    }
    elapsed += now() - start
    done += 1
    const toReport = withWords && Boolean(flip.reportReason)
    if (!toReport) {
      result.total += 1
      if (answer && answerType(answer.answer) === flip.answer) result.right += 1
    }
    if (answer?.report) {
      if (toReport) result.reportsRight += 1
      else result.reportsWrong += 1
    } else if (toReport) result.reportsMissed += 1
    const reasons = (answer && answer.reasons) || []
    if (withWords && (toReport || reasons.length))
      result.reports.push({
        keywords: flip.words.map(({name}) => name),
        reportReason: flip.reportReason || null,
        reasons,
        reported: Boolean(answer && answer.report),
      })
    onProgress(done, flips.length)
  }
  result.seconds = done ? elapsed / done / 1000 : 0
  return result
}
