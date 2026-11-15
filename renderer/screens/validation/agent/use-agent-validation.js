import * as React from 'react'
import {
  agentErrorText,
  agentStatus,
  onAgentChange,
  solveAgentFlip,
  stopAgentSolve,
  setAgentsPaused,
} from '../../settings/agent/api'
import {
  END_MARGIN_MS,
  MIN_FLIP_MS,
  answersToTake,
  appliedKey,
  autopilotEvents,
  flipDeadlineMs,
  flipsLeftToAsk,
  nextFlipToAsk,
  noAnswerReason,
  sessionEnd,
} from './picks'
import {
  KEYWORDS_WAIT_MS,
  MAX_SUBMIT_RETRIES,
  RETRY_SUBMIT_MS,
  SUBMIT_GUARD_MS,
  autopilotPlan,
  isSettled,
} from './autopilot'

// A picture shown from a blob URL, read back as JPEG base64: the app's content policy refuses fetch() of blob URLs,
// an <img> loads them.
function base64Of(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      // JPEG has no transparency: a transparent area shows white, not black.
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1])
    }
    image.onerror = () => reject(new Error('picture not read'))
    image.src = url
  })
}

/** What the agent channel takes for a flip on screen: its pictures (blob URLs read back), orders, keywords. */
async function agentFlip(flip, {isShort}) {
  return {
    images: await Promise.all(flip.images.map(base64Of)),
    orders: flip.orders,
    words: isShort
      ? []
      : (flip.words || []).map(({name, desc}) => ({name, desc})),
  }
}

/**
 * 'autopilot' | 'suggest' from the answering agent's level, 'report' when an agent only reports (B-257: it never
 * answers nor submits), or null when no agent acts in the validation; a pause is apart.
 */
export function agentMode(settings) {
  if (!settings.enabled) return null
  const {level} = settings.permissions.answerFlip
  if (level === 'off')
    return settings.permissions.report?.level &&
      settings.permissions.report.level !== 'off'
      ? 'report'
      : null
  return level === 'alone' ? 'autopilot' : 'suggest'
}

/**
 * The agent beside a validation screen. `flips` are the session's flips as shown, `phase` 'short' | 'long' |
 * 'keywords' | null (not solving), `step` the validation's step for Autopilot (screen.js autopilotStep).
 * Returns null when the agent is off, else its mode ('suggest' | 'autopilot'), whether it is paused, pause() and
 * resume() (a person supervises: pauses, corrects, resumes), its picks by hash, takeRest() (Suggest: an answer for
 * every flip left that has a pick), Autopilot's countdown before a submit (seconds, or null) and noAnswer, why
 * the model's last answer failed ({reason}, or null).
 */
export function useAgentValidation({
  flips,
  phase,
  reportsUsed,
  reportsAllowed,
  step = null,
  send,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
}) {
  const [mode, setMode] = React.useState(null)
  const [savedPause, setSavedPause] = React.useState(false)
  // Pause acts at once, before its save lands; resume waits for the save.
  const [pausing, setPausing] = React.useState(false)
  const paused = savedPause || pausing
  const [picks, setPicks] = React.useState({})
  // Why the model's last answer failed ({reason}), until one comes back: the person is told the agent gives none.
  const [noAnswer, setNoAnswer] = React.useState(null)
  const [asking, setAsking] = React.useState(null)
  const asked = React.useRef(new Set())
  const applied = React.useRef(new Set())
  const seen = React.useRef(new Map())
  const drawn = React.useRef(new Map())
  const live = React.useRef(true)
  const [now, setNow] = React.useState(() => Date.now())
  const [countdown, setCountdown] = React.useState({step: null, end: null})
  const retries = React.useRef({step: null, count: 0, at: 0})
  const submitted = React.useRef(null)

  React.useEffect(() => {
    live.current = true
    const show = ({settings}) => {
      if (!live.current) return
      setMode(agentMode(settings))
      setSavedPause(settings.paused)
      // Only the pause itself ends the screen's own pause: an older write landing first does not lift it.
      if (settings.paused) setPausing(false)
    }
    agentStatus().then(show, () => {})
    // Paused, resumed or changed during the validation (here, or the menu card): the screen follows.
    const off = onAgentChange(show)
    return () => {
      live.current = false
      off()
      // Leaving the validation: the question in flight ends in the main process.
      stopAgentSolve().catch(() => {})
    }
  }, [])

  const active = Boolean(mode) && !paused
  const isShort = phase === 'short'

  // A pause cuts the countdown: after the resume, a new one, from its start. It also forgets the last failure: the
  // agent asks again after the resume (the key may have been fixed meanwhile).
  React.useEffect(() => {
    if (!active) {
      setCountdown({step: null, end: null})
      setNoAnswer(null)
    } else setNow(Date.now())
  }, [active])

  // The long session shows the short session's flips again, with keywords: it starts afresh, its own picks.
  const session = isShort ? 'short' : 'long'
  const sessionRef = React.useRef(session)
  React.useEffect(() => {
    if (!phase || sessionRef.current === session) return
    sessionRef.current = session
    asked.current = new Set()
    applied.current = new Set()
    seen.current = new Map()
    drawn.current = new Map()
    setPicks({})
    setNoAnswer(null)
    setAsking(null)
    stopAgentSolve().catch(() => {})
  }, [phase, session])

  // The clock, only when time matters: Autopilot's countdown, latest submit and retries (a failed submit has no
  // phase), and a long flip waiting for its keywords.
  const waitsForWords =
    !isShort && flips.some((flip) => flip.decoded && !flip.words?.length)
  const needsClock =
    active &&
    ((mode === 'autopilot' && Boolean(step)) ||
      (Boolean(phase) && waitsForWords))
  React.useEffect(() => {
    if (!needsClock) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [needsClock])

  // A long flip loaded without its keywords is asked without them after KEYWORDS_WAIT_MS, from when it loaded.
  flips.forEach((flip) => {
    if (flip.decoded && !seen.current.has(flip.hash))
      seen.current.set(flip.hash, Date.now())
  })
  const withoutWords = new Set(
    flips
      .filter((flip) => now - seen.current.get(flip.hash) >= KEYWORDS_WAIT_MS)
      .map(({hash}) => hash)
  )

  // One flip at a time, the next one as soon as the last is answered. An agent that only reports reads the flips once
  // they have their keywords: the long session.
  React.useEffect(() => {
    if (!active || !phase || asking) return
    if (mode === 'report' && isShort) return
    // An agent that only reports needs the keywords: it never asks a flip without them.
    const flip = nextFlipToAsk(flips, asked.current, {
      isShort,
      withoutWords: mode === 'report' ? new Set() : withoutWords,
    })
    if (!flip) return
    const timeoutMs = flipDeadlineMs({
      end: sessionEnd({
        isShort,
        validationStart,
        shortSessionDuration,
        longSessionDuration,
      }),
      now: Date.now(),
      flipsLeft: flipsLeftToAsk(flips, asked.current),
      isShort,
    })
    if (!timeoutMs) return
    asked.current.add(flip.hash)
    const token = `${session}:${flip.hash}`
    setAsking(token)
    const start = Date.now()
    agentFlip(flip, {isShort})
      .then((data) => solveAgentFlip(data, {reportsUsed, timeoutMs}))
      .then(
        (pick) => ({...pick, seconds: (Date.now() - start) / 1000}),
        (error) => {
          // Cut by a pause: asked again after the resume, not a failure.
          const reason = noAnswerReason(agentErrorText(error))
          return reason === null ? null : {failed: true, reason}
        }
      )
      .then((answer) => {
        // Gone, or a question of the session before: dropped.
        if (!live.current || sessionRef.current !== session) return
        // Refused for the pause (the main process saw it first): asked again after the resume.
        const pick = answer?.decision === 'off' ? null : answer
        if (pick) {
          setPicks((current) => ({...current, [flip.hash]: pick}))
          // eslint-disable-next-line no-nested-ternary
          const failure = pick.failed
            ? pick.reason
            : pick.answerError
            ? noAnswerReason(pick.answerError)
            : null
          setNoAnswer(failure === null ? null : {reason: failure})
        } else asked.current.delete(flip.hash)
        setAsking((current) => (current === token ? null : current))
      })
    // withoutWords changes with the clock; its size says when a flip joined it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    active,
    phase,
    asking,
    flips,
    isShort,
    withoutWords.size,
    session,
    reportsUsed,
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  ])

  // Another agent reports (B-257): a flip asked before its keywords came is asked again for its report once they have.
  const reportedLater = React.useRef(new Set())
  React.useEffect(() => {
    if (!active || isShort || !phase) return
    const flip = flips.find(
      (one) =>
        picks[one.hash]?.reportLater &&
        one.words?.length &&
        !reportedLater.current.has(`${session}:${one.hash}`)
    )
    if (!flip) return
    reportedLater.current.add(`${session}:${flip.hash}`)
    agentFlip(flip, {isShort})
      .then((data) =>
        solveAgentFlip(data, {
          reportsUsed,
          timeoutMs: flipDeadlineMs({
            end: sessionEnd({
              isShort,
              validationStart,
              shortSessionDuration,
              longSessionDuration,
            }),
            now: Date.now(),
            flipsLeft: 1,
            isShort,
          }),
          reportOnly: true,
        })
      )
      .then(
        (late) => {
          if (!live.current || sessionRef.current !== session) return
          setPicks((current) => ({
            ...current,
            [flip.hash]: {
              ...current[flip.hash],
              report: late.report,
              reportDecision: late.reportDecision,
              markDecision: late.markDecision,
              relevance: late.relevance,
              reportLater: false,
            },
          }))
        },
        () => {}
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isShort, phase, flips, picks, session])

  // What the agents may do alone, once per flip: Autopilot's answers, the reporting agent's marks and reports (in any
  // mode: the reporting agent's level is its own).
  React.useEffect(() => {
    if (!active || !phase) return
    autopilotEvents({
      flips,
      picks,
      applied: applied.current,
      isKeywords: phase === 'keywords',
      reportsLeft: reportsAllowed - reportsUsed,
    }).forEach((event) => {
      applied.current.add(appliedKey(event))
      send(event)
    })
  }, [active, phase, flips, picks, reportsUsed, reportsAllowed, send])

  const end = sessionEnd({
    isShort,
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  })
  const countdownEnd = countdown.step === step ? countdown.end : null

  // Autopilot through the validation: random answers where the model gave none, the next step, the submit.
  React.useEffect(() => {
    if (mode !== 'autopilot' || !active || !step) return
    // The time now, not the clock's last tick: after a resume, the tick is the pause's.
    const at = Date.now()
    // Back where a submit starts (the person cancelled its dialog): a submit now is not Autopilot's.
    if (step === 'short' || step === 'keywords') submitted.current = null
    if (step === 'shortFail' || step === 'longFail') {
      const tries = retries.current
      if (tries.step !== step) retries.current = {step, count: 0, at: 0}
      const {count, at: lastAt} = retries.current
      // A few tries, then the person sees the failure and decides.
      if (count < MAX_SUBMIT_RETRIES && at - lastAt >= RETRY_SUBMIT_MS) {
        retries.current = {step, count: count + 1, at}
        send('RETRY_SUBMIT')
      }
      return
    }
    const plan = autopilotPlan({
      step,
      flips,
      picks,
      settled: isSettled(flips, asked.current, {
        asking,
        outOfTime: end - at - END_MARGIN_MS < MIN_FLIP_MS,
      }),
      now: at,
      guardAt: end - SUBMIT_GUARD_MS[isShort ? 'short' : 'long'],
      countdownEnd,
      didSubmit: submitted.current === session,
      drawn: drawn.current,
    })
    plan.events.forEach((event) => {
      if (event.type === 'SUBMIT') submitted.current = session
      send(event)
    })
    if (plan.countdownEnd !== countdownEnd) {
      setCountdown({step, end: plan.countdownEnd})
      // The countdown shown from the time it was set from.
      setNow(at)
    }
  }, [
    mode,
    active,
    step,
    flips,
    picks,
    asking,
    now,
    end,
    isShort,
    session,
    countdownEnd,
    send,
  ])

  if (!mode) return null
  const toTake = answersToTake(flips, picks)
  return {
    mode,
    paused,
    picks,
    asking,
    // The agent's last answer failed: {reason}, or null; not while paused, nor in the keywords check (nothing is
    // asked there).
    noAnswer: active && phase !== 'keywords' ? noAnswer : null,
    countdown:
      mode === 'autopilot' && active && countdownEnd
        ? Math.max(0, Math.ceil((countdownEnd - now) / 1000))
        : null,
    // The pause is the agent's everywhere (the menu card shows it too); here it stops the agent at once.
    // The pause of every agent (the Agents page has it too), not a write of one agent's settings.
    pause: () => {
      setPausing(true)
      setAgentsPaused(true).catch(() => setPausing(false))
    },
    resume: () => setAgentsPaused(false).catch(() => {}),
    takeRest: () => toTake.forEach(send),
    canTakeRest:
      mode === 'suggest' &&
      !paused &&
      phase !== 'keywords' &&
      toTake.length > 0,
  }
}
