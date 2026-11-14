import {AnswerType, RelevanceType} from '../../../shared/types'
import {decodedWithKeywords} from '../utils'

// The agent in a validation (Settings › Agent, "Answer the flips"): Ask me = Suggest, its pick ringed and the
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
    .filter((flip) => !flip.option && pickedSide(picks[flip.hash]))
    .map((flip) => ({
      type: 'ANSWER',
      hash: flip.hash,
      option: pickedSide(picks[flip.hash]),
    }))
}

const unmarked = (flip) =>
  !flip.relevance || flip.relevance === RelevanceType.Abstained

/**
 * Autopilot's events: the answers its permission lets it give alone, and in the keywords check its marks (a
 * report only when its report permission is Alone too). `applied` holds what it already did, so a mark the person
 * changed is never put back; the person's own answer is never replaced. `reportsLeft`: the session's reports not
 * used yet (the permission was checked when the flip was asked, before any report).
 */
export function autopilotEvents({
  flips,
  picks,
  applied,
  isKeywords,
  reportsLeft = 0,
}) {
  const events = []
  let left = reportsLeft
  flips.forEach((flip) => {
    const pick = picks[flip.hash]
    if (!pick || pick.decision !== 'alone') return
    const side = pickedSide(pick)
    if (side && !flip.option && !applied.has(`answer:${flip.hash}`))
      events.push({type: 'ANSWER', hash: flip.hash, option: side})
    if (!isKeywords || applied.has(`mark:${flip.hash}`) || !unmarked(flip))
      return
    if (pick.report) {
      if (pick.reportDecision === 'alone' && left > 0) {
        left -= 1
        events.push({type: 'REPORT_WORDS', hash: flip.hash})
      }
    } else if (!pick.report && pick.relevance === 'relevant')
      events.push({type: 'APPROVE_WORDS', hash: flip.hash})
  })
  return events
}

/** What `applied` records for an event sent. */
export const appliedKey = ({type, hash}) =>
  `${type === 'ANSWER' ? 'answer' : 'mark'}:${hash}`
