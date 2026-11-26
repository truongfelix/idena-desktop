import {AnswerType} from '../../../shared/types'
import {END_MARGIN_MS, MIN_FLIP_MS, pickedSide} from './picks'

// Autopilot through the whole validation (owner 2026-11-12): every flip shown gets an answer (the model's pick, a
// random side when the model could not answer in time), and the agent submits both sessions itself. Each submit
// waits for a countdown, so a person behind it can pause the agent, correct, and resume; something is always
// submitted before the session's end. A flip that did not load ("No data available. Please skip the flip.") is
// left unanswered, as the validation asks.

/** The countdown before Autopilot submits a session. */
export const SUBMIT_COUNTDOWN_MS = 30 * 1000
/**
 * At the latest, before the session's end as the machine counts it: the short session's own auto-submit comes 10 s
 * before its end (already in the end); the long answers must reach a block before the long session closes.
 */
export const SUBMIT_GUARD_MS = {short: 5 * 1000, long: 30 * 1000}
/** A failed submit is tried again after this pause, at most this many times per step. */
export const RETRY_SUBMIT_MS = 5 * 1000
export const MAX_SUBMIT_RETRIES = 3
/** A long flip whose keywords have not come after this long is asked without them. */
export const KEYWORDS_WAIT_MS = 60 * 1000

const isLoaded = (flip) =>
  Boolean(flip.decoded) && !flip.failed && flip.images?.length > 0
const isLoading = (flip) => !flip.fetched && !flip.failed

/**
 * The answers Autopilot gives itself, for the loaded flips still without one: a random side where the model gave
 * none (failed, timed out, skipped); with `all` (time is up, or nothing is left to ask), every such flip, with the
 * model's side where it picked one. `drawn` keeps each flip's random side, so one flip never gets two.
 */
export function fallbackAnswers(
  flips,
  picks,
  {all = false, drawn = new Map(), random = Math.random}
) {
  const side = (hash) => {
    if (!drawn.has(hash))
      drawn.set(hash, random() < 0.5 ? AnswerType.Left : AnswerType.Right)
    return drawn.get(hash)
  }
  return flips
    .filter((flip) => isLoaded(flip) && !flip.option)
    .map((flip) => {
      const pick = picks[flip.hash]
      const picked = pickedSide(pick)
      if (picked) return all ? {hash: flip.hash, option: picked} : null
      if (all || pick) return {hash: flip.hash, option: side(flip.hash)}
      return null
    })
    .filter(Boolean)
    .map((answer) => ({type: 'ANSWER', ...answer}))
}

/**
 * Nothing left for the agent to ask in this session: no question in flight, and every flip asked or never to be
 * (it did not load), or no time left to ask. A flip still loading, or waiting for its keywords, is not settled.
 */
export function isSettled(flips, asked, {asking, outOfTime}) {
  if (asking) return false
  if (outOfTime) return true
  return flips.every(
    (flip) => asked.has(flip.hash) || (!isLoaded(flip) && !isLoading(flip))
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
 * `settled`: isSettled; `guardAt`: when it must submit at the latest; `countdownEnd`: the running countdown's;
 * `didSubmit`: Autopilot sent this session's SUBMIT itself (it confirms only its own, never the person's).
 */
export function autopilotPlan({
  step,
  flips,
  picks,
  settled,
  now,
  guardAt,
  countdownEnd = null,
  didSubmit = false,
  drawn,
  random,
}) {
  const late = now >= guardAt
  const none = {events: [], countdownEnd: null}
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
      return didSubmit ? {events: [{type: 'SUBMIT'}], countdownEnd: null} : none
    case 'short':
    case 'long': {
      const fill = fallbackAnswers(flips, picks, {
        all: late || settled,
        drawn,
        random,
      })
      const filled = new Set(fill.map(({hash}) => hash))
      const done =
        flips.every(
          (flip) => flip.option || filled.has(flip.hash) || !isLoaded(flip)
        ) &&
        (late || (flips.length > 0 && !flips.some(isLoading)))
      if (!done) return {events: fill, countdownEnd: null}
      // The long flips answered: on to the keywords; the submit's countdown runs there.
      if (step === 'long')
        return {events: [...fill, {type: 'FINISH_FLIPS'}], countdownEnd: null}
      return withCountdown(fill, {now, guardAt, countdownEnd})
    }
    case 'keywords':
      if (!settled && !late) return none
      return withCountdown([], {now, guardAt, countdownEnd})
    default:
      return none
  }
}

/**
 * When the agent must look at the clock again (ms), or null: the first of its deadlines still to come after `now`
 * (B-302: the screen is drawn again at these moments only, never each second). `asks`: the agent asks flips in this
 * session (the moment no time is left for a question, and in the long session each loaded flip's wait for its
 * keywords, from `seen`, its hash -> when it loaded); `autopilot`: Autopilot acts at a step (the latest submit, the
 * countdown's end, `retryAt`: the next try of a failed submit).
 */
export function nextWakeAt({
  now,
  end,
  isShort,
  asks = false,
  autopilot = false,
  flips = [],
  seen = new Map(),
  countdownEnd = null,
  retryAt = null,
}) {
  const times = []
  // The first moment the hook's `outOfTime` holds (its test is strict).
  if (asks || autopilot) times.push(end - END_MARGIN_MS - MIN_FLIP_MS + 1)
  if (asks && !isShort)
    flips.forEach((flip) => {
      if (flip.decoded && !flip.words?.length && seen.has(flip.hash))
        times.push(seen.get(flip.hash) + KEYWORDS_WAIT_MS)
    })
  if (autopilot) {
    times.push(end - SUBMIT_GUARD_MS[isShort ? 'short' : 'long'])
    if (countdownEnd) times.push(countdownEnd)
    if (retryAt) times.push(retryAt)
  }
  const ahead = times.filter((at) => Number.isFinite(at) && at > now)
  return ahead.length ? Math.min(...ahead) : null
}
