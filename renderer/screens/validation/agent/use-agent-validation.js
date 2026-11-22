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
  askAgain,
  autopilotEvents,
  bestSuggestionOf,
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
  nextWakeAt,
} from './autopilot'
import {WINDOW_COMMAND} from '../../../../main/channels'

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
 * every flip left that has a pick), when Autopilot submits (countdownEnd, ms, or null) and noAnswer, why
 * the model's last answer failed ({reason}, or null).
 */
export function useAgentValidation({
  flips,
  phase,
  reportsUsed,
  reportsAllowed,
  // Whether a best flip is marked (B-260): the agent marks one only when none is.
  hasBest = false,
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
  // The same, set the moment a question starts (B-267): a render that comes before `asking` lands (Autopilot's own
  // answer re-renders the screen) never starts a second one.
  const askingNow = React.useRef(null)
  // The late report's question in flight, the same way (lateAsking, below).
  const lateNow = React.useRef(null)
  const asked = React.useRef(new Set())
  // Each flip's questions so far, by hash (B-263: a failed one is asked again a few times).
  const triesOf = React.useRef(new Map())
  // The flips to ask again, by hash, with the last failure's reason (their failed pick when no time is left).
  const again = React.useRef(new Map())
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
  // agent asks again after the resume (the key may have been fixed meanwhile); a flip to ask again gets all its tries.
  React.useEffect(() => {
    if (!active) {
      setCountdown({step: null, end: null})
      setNoAnswer(null)
      triesOf.current = new Map()
      again.current = new Map()
    } else setNow(Date.now())
  }, [active])

  // The long session shows the short session's flips again, with keywords: it starts afresh, its own picks.
  const session = isShort ? 'short' : 'long'
  const sessionRef = React.useRef(session)
  React.useEffect(() => {
    if (!phase || sessionRef.current === session) return
    sessionRef.current = session
    asked.current = new Set()
    triesOf.current = new Map()
    again.current = new Map()
    applied.current = new Set()
    seen.current = new Map()
    drawn.current = new Map()
    setPicks({})
    setNoAnswer(null)
    setAsking(null)
    askingNow.current = null
    lateNow.current = null
    stopAgentSolve().catch(() => {})
  }, [phase, session])

  // While an agent acts, the window's timers keep their time when it is hidden or minimized (B-302).
  React.useEffect(() => {
    if (!active) return undefined
    global.ipcRenderer?.send(WINDOW_COMMAND, 'agent-awake', {on: true})
    return () =>
      global.ipcRenderer?.send(WINDOW_COMMAND, 'agent-awake', {on: false})
  }, [active])

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
    if (!active || !phase || asking || askingNow.current) return
    if (mode === 'report' && isShort) return
    // An agent that only reports needs the keywords: it never asks a flip without them.
    const flip = nextFlipToAsk(
      flips,
      asked.current,
      {
        isShort,
        withoutWords: mode === 'report' ? new Set() : withoutWords,
      },
      again.current
    )
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
    if (!timeoutMs) {
      // No time left to ask them again (B-263): the flips that failed keep their failure, as after their last try.
      if (again.current.size) {
        const failed = {}
        again.current.forEach((reason, hash) => {
          asked.current.add(hash)
          failed[hash] = {failed: true, reason}
        })
        again.current = new Map()
        setPicks((current) => ({...current, ...failed}))
      }
      return
    }
    asked.current.add(flip.hash)
    again.current.delete(flip.hash)
    const token = `${session}:${flip.hash}`
    askingNow.current = token
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
        // A model error (B-263): asked again, at most twice more, after the flips not asked yet and while the
        // session gives the flip time; the error shows meanwhile.
        if (answer?.failed) {
          const tries = (triesOf.current.get(flip.hash) || 0) + 1
          triesOf.current.set(flip.hash, tries)
          if (askAgain(tries)) {
            asked.current.delete(flip.hash)
            again.current.set(flip.hash, answer.reason)
            setNoAnswer({reason: answer.reason})
            if (askingNow.current === token) askingNow.current = null
            setAsking((current) => (current === token ? null : current))
            return
          }
        }
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
        if (askingNow.current === token) askingNow.current = null
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

  // Another agent reports (B-257): a flip asked before its keywords came is asked again for its report once they
  // have, one at a time; a question stopped (a pause) is asked again, a failed one is given up.
  const reportedLater = React.useRef(new Set())
  const [lateAsking, setLateAsking] = React.useState(null)
  React.useEffect(() => {
    if (!active || isShort || !phase || lateAsking || lateNow.current) return
    const flip = flips.find(
      (one) =>
        picks[one.hash]?.reportLater &&
        one.words?.length &&
        !reportedLater.current.has(`${session}:${one.hash}`)
    )
    if (!flip) return
    const timeoutMs = flipDeadlineMs({
      end: sessionEnd({
        isShort,
        validationStart,
        shortSessionDuration,
        longSessionDuration,
      }),
      now: Date.now(),
      flipsLeft: 1,
      isShort,
    })
    // No time left for it in the session: not asked.
    if (!timeoutMs) return
    const key = `${session}:${flip.hash}`
    reportedLater.current.add(key)
    lateNow.current = key
    setLateAsking(key)
    agentFlip(flip, {isShort})
      .then((data) =>
        solveAgentFlip(data, {reportsUsed, timeoutMs, reportOnly: true})
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
              reportSide: late.reportSide,
              reportConfidence: late.reportConfidence,
              quality: late.quality,
              doubted: late.doubted,
              reportLater: false,
            },
          }))
        },
        (error) => {
          // Stopped by a pause: asked again after the resume.
          if (noAnswerReason(agentErrorText(error)) === null)
            reportedLater.current.delete(key)
        }
      )
      .finally(() => {
        if (lateNow.current === key) lateNow.current = null
        setLateAsking((current) => (current === key ? null : current))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isShort, phase, flips, picks, session, lateAsking])

  // A late report still to ask (its keywords came, not asked yet), and whether the session has no time left for more:
  // both settle the flips (Autopilot's submit, the best flip). The clock changes `outOfTime` once.
  const latePending = flips.some(
    (one) =>
      picks[one.hash]?.reportLater &&
      one.words?.length &&
      !reportedLater.current.has(`${session}:${one.hash}`)
  )
  const outOfTime =
    sessionEnd({
      isShort,
      validationStart,
      shortSessionDuration,
      longSessionDuration,
    }) -
      now -
      END_MARGIN_MS <
    MIN_FLIP_MS

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
      hasBest,
      // Every flip it can still ask was asked, late reports included (the same as Autopilot's submit waits for).
      settled: isSettled(flips, asked.current, {
        asking: asking || lateAsking || latePending,
        outOfTime,
      }),
    }).forEach((event) => {
      applied.current.add(appliedKey(event))
      send(event)
    })
  }, [
    active,
    phase,
    flips,
    picks,
    reportsUsed,
    reportsAllowed,
    hasBest,
    send,
    asking,
    lateAsking,
    latePending,
    outOfTime,
  ])

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
      // A late report in flight, or one to ask, holds the submit too (B-257).
      settled: isSettled(flips, asked.current, {
        asking:
          asking ||
          lateAsking ||
          flips.some(
            (one) =>
              picks[one.hash]?.reportLater &&
              one.words?.length &&
              !reportedLater.current.has(`${session}:${one.hash}`)
          ),
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
    if (plan.countdownEnd !== countdownEnd)
      setCountdown({step, end: plan.countdownEnd})
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
    lateAsking,
  ])

  // The clock (B-302): one timer to the next deadline, set again after each render; the screen is drawn again
  // then, never each second. Runs after Autopilot's step above, which moves the submit's retries.
  const autopilotActs = mode === 'autopilot' && active && Boolean(step)
  const failedStep = step === 'shortFail' || step === 'longFail'
  React.useEffect(() => {
    // Read here: Autopilot's step above has just moved them.
    const submitTries = retries.current
    const wakeAt = nextWakeAt({
      now: Date.now(),
      end,
      isShort,
      asks: active && Boolean(phase),
      autopilot: autopilotActs,
      flips,
      seen: seen.current,
      countdownEnd,
      retryAt:
        autopilotActs &&
        failedStep &&
        submitTries.step === step &&
        submitTries.count < MAX_SUBMIT_RETRIES
          ? submitTries.at + RETRY_SUBMIT_MS
          : null,
    })
    if (wakeAt === null) return undefined
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, wakeAt - Date.now())
    )
    return () => clearTimeout(timer)
  })

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
    // When Autopilot submits (ms), or null: the screen's countdown ticks on its own (B-302).
    countdownEnd: mode === 'autopilot' && active ? countdownEnd : null,
    // The pause is the agent's everywhere (the menu card shows it too); here it stops the agent at once.
    // The pause of every agent (the Agents page has it too), not a write of one agent's settings.
    pause: () => {
      setPausing(true)
      setAgentsPaused(true).catch(() => setPausing(false))
    },
    resume: () => setAgentsPaused(false).catch(() => {}),
    takeRest: () => toTake.forEach(send),
    // The flip it would mark best, for the person's click (its marks asked first: Ask me); null when it marks alone,
    // or a best flip is marked.
    bestSuggestion:
      active && phase === 'keywords' && !hasBest
        ? bestSuggestionOf(flips, picks)
        : null,
    canTakeRest:
      mode === 'suggest' &&
      !paused &&
      phase !== 'keywords' &&
      toTake.length > 0,
  }
}
