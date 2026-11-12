import * as React from 'react'
import {
  agentErrorText,
  agentStatus,
  onAgentChange,
  solveAgentFlip,
  stopAgentSolve,
  updateAgentSettings,
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
  sessionEnd,
} from './picks'
import {
  KEYWORDS_WAIT_MS,
  MAX_SUBMIT_RETRIES,
  RETRY_SUBMIT_MS,
  SUBMIT_COUNTDOWN_MS,
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

/** 'autopilot' | 'suggest' from the settings, or null when the agent does not answer; a pause is apart. */
export function agentMode(settings) {
  const {level} = settings.permissions.answerFlip
  if (!settings.enabled || level === 'off') return null
  return level === 'alone' ? 'autopilot' : 'suggest'
}

/**
 * The agent beside a validation screen. `flips` are the session's flips as shown, `phase` 'short' | 'long' |
 * 'keywords' | null (not solving), `step` the validation's step for Autopilot (screen.js autopilotStep).
 * Returns null when the agent is off, else its mode ('suggest' | 'autopilot'), whether it is paused, pause() and
 * resume() (a person supervises: pauses, corrects, resumes), its picks by hash, takeRest() (Suggest: an answer for
 * every flip left that has a pick) and Autopilot's countdown before a submit (seconds, or null).
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
      setPausing(false)
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

  // A pause cuts the countdown: after the resume, a new one, from its start.
  React.useEffect(() => {
    if (!active) setCountdown({step: null, end: null})
    else setNow(Date.now())
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
    setAsking(null)
    stopAgentSolve().catch(() => {})
  }, [phase, session])

  // The clock: the countdown, the latest submit and the wait for keywords move with time, not only with the state.
  React.useEffect(() => {
    if (!active || !phase) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, phase])

  // A long flip loaded without its keywords is asked without them after KEYWORDS_WAIT_MS.
  flips.forEach((flip) => {
    if (flip.decoded && !seen.current.has(flip.hash))
      seen.current.set(flip.hash, now)
  })
  const withoutWords = new Set(
    flips
      .filter((flip) => now - seen.current.get(flip.hash) >= KEYWORDS_WAIT_MS)
      .map(({hash}) => hash)
  )

  // One flip at a time, the next one as soon as the last is answered.
  React.useEffect(() => {
    if (!active || !phase || asking) return
    const flip = nextFlipToAsk(flips, asked.current, {isShort, withoutWords})
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
        (error) =>
          // Cut by a pause: asked again after the resume, not a failure.
          agentErrorText(error) === 'stopped' ? null : {failed: true}
      )
      .then((pick) => {
        // Gone, or a question of the session before: dropped.
        if (!live.current || sessionRef.current !== session) return
        if (pick) setPicks((current) => ({...current, [flip.hash]: pick}))
        else asked.current.delete(flip.hash)
        setAsking((current) => (current === token ? null : current))
      })
    // withoutWords changes with the clock; its size says when a flip joined it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
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

  // Autopilot: what its permissions let it do alone, once per flip.
  React.useEffect(() => {
    if (mode !== 'autopilot' || !active || !phase) return
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
  }, [mode, active, phase, flips, picks, reportsUsed, reportsAllowed, send])

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
  ])

  if (!mode) return null
  const toTake = answersToTake(flips, picks)
  return {
    mode,
    paused,
    picks,
    asking,
    countdown:
      mode === 'autopilot' && active && countdownEnd
        ? // The clock ticks after the countdown was set: never above its length.
          Math.min(
            SUBMIT_COUNTDOWN_MS / 1000,
            Math.max(0, Math.ceil((countdownEnd - now) / 1000))
          )
        : null,
    // The pause is the agent's everywhere (the menu card shows it too); here it stops the agent at once.
    pause: () => {
      setPausing(true)
      updateAgentSettings((s) => ({...s, paused: true})).catch(() =>
        setPausing(false)
      )
    },
    resume: () =>
      updateAgentSettings((s) => ({...s, paused: false})).catch(() => {}),
    takeRest: () => toTake.forEach(send),
    canTakeRest:
      mode === 'suggest' &&
      !paused &&
      phase !== 'keywords' &&
      toTake.length > 0,
  }
}
