import {AnswerType, RelevanceType} from '../../../shared/types'
import {decodedWithKeywords} from '../utils'

// The agent in a validation (its action "Answer the flips", on its page in Agents): Ask me = Suggest, its pick ringed and the
// person clicks; Alone = Autopilot, it answers within the session's time. A flip is asked once, one at a time, as
// the validation shows them. The validation machine is not changed: the agent sends the person's own events.

/**
 * The agent's color, from the approved design: light purple on the short session (always dark), the theme's own
 * (dark purple in the light theme, light in the dark one) elsewhere. `on…`: the text on it.
 */
export const AGENT_COLORS = {
  dark: '#c4b5fd',
  onDark: '#16161d',
  themed: 'rgb(var(--idena-agent))',
  onThemed: 'rgb(var(--idena-agent-on))',
}

/** The longest a model may think on one flip: a short session flip as the practice test gives it, a long one 1 min. */
export const SHORT_FLIP_MAX_MS = 20 * 1000
export const LONG_FLIP_MAX_MS = 60 * 1000
/** Kept for the answer to land before the session's end. */
export const END_MARGIN_MS = 5 * 1000
/** Below this a model has no time to answer: the flip is not asked. */
export const MIN_FLIP_MS = 2 * 1000
/** The longest error shown on the validation screen when the model gave no answer. */
export const NO_ANSWER_MAX_CHARS = 160

/**
 * Why the agent gave no answer (the model's error, or the app's before the call), as the validation screen shows it: the error's text, cut to NO_ANSWER_MAX_CHARS;
 * null for a question stopped by a pause (asked again after the resume, not a failure).
 */
/** A flip's questions at most: the first and two more after a model error (B-263). */
export const MAX_FLIP_TRIES = 3

/**
 * Whether a flip whose question failed (`tries` made so far) is asked again: fewer than MAX_FLIP_TRIES, and the
 * session still gives it a share of its time (`timeoutMs`, flipDeadlineMs of the flips left with it; null: none).
 */
export const askAgain = (tries, timeoutMs) =>
  tries < MAX_FLIP_TRIES && Boolean(timeoutMs)

export function noAnswerReason(text) {
  const reason = String(text || '').trim()
  if (reason === 'stopped') return null
  // By characters, not UTF-16 units: an emoji is never cut in two.
  const chars = Array.from(reason)
  return chars.length > NO_ANSWER_MAX_CHARS
    ? `${chars
        .slice(0, NO_ANSWER_MAX_CHARS - 1)
        .join('')
        .trimEnd()}…`
    : reason
}

/** When the session's answers close, as the machine's own timers count them (SHORT_SESSION_AUTO_SUBMIT …). */
export function sessionEnd({
  isShort,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
}) {
  const shortEnd = validationStart + (shortSessionDuration - 10) * 1000
  return isShort ? shortEnd : shortEnd + longSessionDuration * 1000
}

/** The time one flip gets: the time left shared by the flips left, at most the cap; null when too short. */
export function flipDeadlineMs({end, now, flipsLeft, isShort}) {
  const left = end - now - END_MARGIN_MS
  const share = left / Math.max(1, flipsLeft)
  const ms = Math.min(isShort ? SHORT_FLIP_MAX_MS : LONG_FLIP_MAX_MS, share)
  return ms >= MIN_FLIP_MS ? Math.floor(ms) : null
}

/**
 * A flip the agent can be asked: its pictures read, and in the long session its keywords too, or none once the agent
 * stopped waiting for them (`withoutWords`, the hashes).
 */
export function isAskable(flip, {isShort, withoutWords = new Set()}) {
  if (!flip || flip.failed || !flip.decoded || !flip.images?.length)
    return false
  return isShort || withoutWords.has(flip.hash) || decodedWithKeywords(flip)
}

/** The next flip to ask, in the order shown; `asked` holds the hashes already asked. */
export function nextFlipToAsk(flips, asked, options) {
  return flips.find((flip) => !asked.has(flip.hash) && isAskable(flip, options))
}

/** The flips not asked yet that can still be (not failed), to share the time left between them. */
export function flipsLeftToAsk(flips, asked) {
  return flips.filter(
    (flip) =>
      !asked.has(flip.hash) && !flip.failed && !(flip.fetched && !flip.decoded)
  ).length
}

/** The side of the agent's pick (AnswerType), or null when it skips. */
export function pickedSide(pick) {
  if (pick?.answer === 'left') return AnswerType.Left
  if (pick?.answer === 'right') return AnswerType.Right
  return null
}

/** "Take the agent's picks for the rest": an ANSWER for each flip still without an answer that has a pick. */
export function answersToTake(flips, picks) {
  return flips
    .filter(
      (flip) =>
        !flip.option &&
        picks[flip.hash]?.answers !== false &&
        pickedSide(picks[flip.hash])
    )
    .map((flip) => ({
      type: 'ANSWER',
      hash: flip.hash,
      option: pickedSide(picks[flip.hash]),
    }))
}

const unmarked = (flip) =>
  !flip.relevance || flip.relevance === RelevanceType.Abstained

/** Whether the agent marks this flip's keywords alone: the reporting agent's level, or the one agent's. */
export const marksAlone = (pick) =>
  (pick.markDecision ?? pick.decision) === 'alone'

/** The flip the agent would mark best for the person's click (its marks asked first: Ask me), or null. */
export const bestSuggestionOf = (flips, picks) =>
  bestFlipOf(
    flips.filter((flip) => picks[flip.hash] && !marksAlone(picks[flip.hash])),
    picks
  )?.hash ?? null

/**
 * The flip the agent would mark best (B-260, B-261): among the flips approved (relevant) whose agent judged them
 * relevant, the one it found best (its quality; a flip without one comes after, by its surest answer). Every long
 * session gets one when the agent approved a flip; null when none. The first of equals, in the session's order.
 */
export function bestFlipOf(flips, picks) {
  // A rule break half suspected comes last (chosen only when every approved flip is doubted).
  const rank = (pick) => [
    // eslint-disable-next-line no-nested-ternary
    pick.doubted ? -2 : typeof pick.quality === 'number' ? pick.quality : -1,
    pick.confidence || 0,
  ]
  const better = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
  let best = null
  flips.forEach((flip) => {
    const pick = picks[flip.hash]
    if (
      !pick ||
      flip.relevance !== RelevanceType.Relevant ||
      pick.relevance !== 'relevant' ||
      pick.report
    )
      return
    if (!best || better(rank(pick), rank(picks[best.hash]))) best = flip
  })
  return best
}

/**
 * Autopilot's events: the answers its permission lets it give alone, and in the keywords check the marks its level
 * lets it make alone: the reports (the surest first when there are more than `reportsLeft`, the session's reports
 * not used yet, B-259), the approvals, then the best flip (B-260, B-261) once every approval it makes is in and the
 * flips are `settled`, when none is marked yet (`hasBest`). `applied` holds what it already did, so a mark the person changed is never put back; the
 * person's own answer is never replaced.
 */
export function autopilotEvents({
  flips,
  picks,
  applied,
  isKeywords,
  reportsLeft = 0,
  hasBest = false,
  // Every flip it can still ask was asked, none in flight (autopilot.js isSettled): the best flip waits for it.
  settled = true,
}) {
  const events = []
  flips.forEach((flip) => {
    const pick = picks[flip.hash]
    // An answer only from the agent answering (B-257: a reporting agent alone gives none).
    const side = pickedSide(pick)
    if (
      pick &&
      pick.answers !== false &&
      pick.decision === 'alone' &&
      side &&
      !flip.option &&
      !applied.has(`answer:${flip.hash}`)
    )
      events.push({type: 'ANSWER', hash: flip.hash, option: side})
  })
  if (!isKeywords) return events
  // The keywords' marks: the reporting agent's level, or the answering agent's when one agent does both.
  const markable = flips.filter((flip) => {
    const pick = picks[flip.hash]
    return (
      pick &&
      marksAlone(pick) &&
      !applied.has(`mark:${flip.hash}`) &&
      unmarked(flip)
    )
  })
  const confidence = (flip) => picks[flip.hash].reportConfidence || 0
  markable
    .filter(
      (flip) =>
        picks[flip.hash].report && picks[flip.hash].reportDecision === 'alone'
    )
    .sort((a, b) => confidence(b) - confidence(a))
    .slice(0, Math.max(0, reportsLeft))
    .forEach((flip) => events.push({type: 'REPORT_WORDS', hash: flip.hash}))
  const approvals = markable.filter(
    (flip) =>
      !picks[flip.hash].report && picks[flip.hash].relevance === 'relevant'
  )
  approvals.forEach((flip) =>
    events.push({type: 'APPROVE_WORDS', hash: flip.hash})
  )
  // The best flip: once every flip has its pick and every approval is in the flips (a later pass); never over the
  // person's own. Chosen again only when the flip it marked lost its mark to a report (a person's unmarking stays).
  const marked = [...applied].find((key) => key.startsWith('best:'))
  const lost =
    marked &&
    flips.some(
      (flip) =>
        `best:${flip.hash}` === marked &&
        flip.relevance !== RelevanceType.Relevant
    )
  // `settled` holds the late reports still to ask too (the hook's): one that can never come holds nothing back.
  if (!hasBest && !approvals.length && settled && (!marked || lost)) {
    const best = bestFlipOf(
      flips.filter(
        (flip) =>
          marksAlone(picks[flip.hash] || {}) && `best:${flip.hash}` !== marked
      ),
      picks
    )
    if (best) events.push({type: 'MARK_BEST', hash: best.hash})
  }
  return events
}

/** What `applied` records for an event sent. */
export function appliedKey({type, hash}) {
  if (type === 'MARK_BEST') return `best:${hash}`
  return `${type === 'ANSWER' ? 'answer' : 'mark'}:${hash}`
}
