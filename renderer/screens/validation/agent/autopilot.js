import {AnswerType} from '../../../shared/types'
import {pickedSide} from './picks'

// Autopilot through the whole validation (owner 2026-11-12): every flip gets an answer (the model's pick, a random
// side when it could not answer in time or could not read the flip), and the agent submits both sessions itself.
// Each submit waits for a countdown, so a person behind it can pause the agent and take over, and something is
// always submitted before the session's end.

/** The countdown before Autopilot submits a session. */
export const SUBMIT_COUNTDOWN_MS = 30 * 1000
/**
 * At the latest, before the session's end as the machine counts it: the short session's own auto-submit comes 10 s
 * before its end (already in the end); the long answers must reach a block before the long session closes.
 */
export const SUBMIT_GUARD_MS = {short: 5 * 1000, long: 30 * 1000}
/** A failed submit is tried again after this pause. */
export const RETRY_SUBMIT_MS = 5 * 1000

/** A flip the agent will not answer itself: unreadable, or the model answered nothing (failed, skipped). */
export function cannotAnswer(flip, pick) {
  return (
    Boolean(flip.failed) ||
    Boolean(flip.fetched && !flip.decoded) ||
    Boolean(pick && !pickedSide(pick))
  )
}

/**
 * A random side for each flip without an answer that the agent cannot answer, or for all of them (`all`). A flip the
 * model picked a side for never gets one: its answer goes out with autopilotEvents, maybe in this same render.
 */
export function randomAnswers(
  flips,
  picks,
  {all = false, random = Math.random}
) {
  return flips
    .filter(
      (flip) =>
        !flip.option &&
        !pickedSide(picks[flip.hash]) &&
        (all || cannotAnswer(flip, picks[flip.hash]))
    )
    .map((flip) => ({
      type: 'ANSWER',
      hash: flip.hash,
      option: random() < 0.5 ? AnswerType.Left : AnswerType.Right,
    }))
}

/**
 * Nothing left for the agent to ask in this session: no question in flight, and every flip asked or never
 * askable (unreadable), or no time left to ask. A flip still loading, or waiting for its keywords, is not settled.
 */
export function isSettled(flips, asked, {asking, outOfTime}) {
  if (asking) return false
  if (outOfTime) return true
  return flips.every(
    (flip) =>
      asked.has(flip.hash) || flip.failed || (flip.fetched && !flip.decoded)
  )
}

function withCountdown(events, {now, guardAt, countdownEnd}) {
  const end = countdownEnd ?? Math.min(now + SUBMIT_COUNTDOWN_MS, guardAt)
  if (now >= end)
    return {events: [...events, {type: 'SUBMIT'}], countdownEnd: null}
  return {events, countdownEnd: end}
}

/**
 * Autopilot's next events at a validation step (screen.js autopilotStep), and the countdown's end (ms, or null).
 * `settled`: isSettled; `guardAt`: when it must submit at the latest; `countdownEnd`: the running countdown's.
 */
export function autopilotPlan({
  step,
  flips,
  picks,
  settled,
  now,
  guardAt,
  countdownEnd = null,
  random = Math.random,
}) {
  const late = now >= guardAt
  switch (step) {
    case 'welcome':
      return {events: [{type: 'START_LONG_SESSION'}], countdownEnd: null}
    case 'finish':
      return {
        events: [{type: 'START_KEYWORDS_QUALIFICATION'}],
        countdownEnd: null,
      }
    case 'shortConfirm':
    case 'review':
      return {events: [{type: 'SUBMIT'}], countdownEnd: null}
    case 'short':
    case 'long': {
      const fill = randomAnswers(flips, picks, {all: late || settled, random})
      const filled = new Set(fill.map(({hash}) => hash))
      const allAnswered = flips.every(
        (flip) =>
          flip.option || filled.has(flip.hash) || pickedSide(picks[flip.hash])
      )
      if (!flips.length || !allAnswered)
        return {events: fill, countdownEnd: null}
      // The long flips answered: on to the keywords; the submit's countdown runs there.
      if (step === 'long')
        return {events: [...fill, {type: 'FINISH_FLIPS'}], countdownEnd: null}
      return withCountdown(fill, {now, guardAt, countdownEnd})
    }
    case 'keywords':
      if (!settled && !late) return {events: [], countdownEnd: null}
      return withCountdown([], {now, guardAt, countdownEnd})
    default:
      return {events: [], countdownEnd: null}
  }
}
