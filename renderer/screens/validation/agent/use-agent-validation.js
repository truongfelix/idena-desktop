import * as React from 'react'
import {
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

/** 'autopilot' | 'suggest' from the settings, or null when the agent does not answer (off, paused). */
export function agentMode(settings) {
  const {level} = settings.permissions.answerFlip
  if (!settings.enabled || settings.paused || level === 'off') return null
  return level === 'alone' ? 'autopilot' : 'suggest'
}

/**
 * The agent beside a validation screen. `flips` are the session's flips as shown, `phase` 'short' | 'long' |
 * 'keywords' | null (not solving), `step` the validation's step for Autopilot (screen.js autopilotStep),
 * `keywordsDone` whether the validation stopped fetching keywords. Autopilot answers every flip and submits both
 * sessions after a countdown (`countdown`, seconds), which pause() stops. Returns null when the agent is off, else its mode ('suggest' | 'autopilot'),
 * its picks by hash, and takeRest() (Suggest: an answer for every flip left that has a pick).
 */
export function useAgentValidation({
  flips,
  phase,
  reportsUsed,
  reportsAllowed,
  step = null,
  keywordsDone = false,
  send,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
}) {
  const [mode, setMode] = React.useState(null)
  const [picks, setPicks] = React.useState({})
  const [asking, setAsking] = React.useState(null)
  const asked = React.useRef(new Set())
  const applied = React.useRef(new Set())
  const live = React.useRef(true)
  const [now, setNow] = React.useState(() => Date.now())
  const [countdown, setCountdown] = React.useState({step: null, end: null})
  const lastRetry = React.useRef(0)

  React.useEffect(() => {
    live.current = true
    const show = ({settings}) => live.current && setMode(agentMode(settings))
    agentStatus().then(show, () => {})
    // Paused, resumed or changed during the validation (the menu card): the screen follows.
    const off = onAgentChange(show)
    return () => {
      live.current = false
      off()
      // Leaving the validation: the question in flight ends in the main process.
      stopAgentSolve().catch(() => {})
    }
  }, [])

  const isShort = phase === 'short'

  // The long session shows the short session's flips again, with keywords: it starts afresh, its own picks.
  const session = isShort ? 'short' : 'long'
  const sessionRef = React.useRef(session)
  React.useEffect(() => {
    if (!phase || sessionRef.current === session) return
    sessionRef.current = session
    asked.current = new Set()
    applied.current = new Set()
    setPicks({})
    setAsking(null)
    stopAgentSolve().catch(() => {})
  }, [phase, session])

  // One flip at a time, the next one as soon as the last is answered.
  React.useEffect(() => {
    if (!mode || !phase || asking) return
    const flip = nextFlipToAsk(flips, asked.current, {isShort, keywordsDone})
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
        () => ({failed: true})
      )
      .then((pick) => {
        // Gone, or a question of the session before: dropped.
        if (!live.current || sessionRef.current !== session) return
        setPicks((current) => ({...current, [flip.hash]: pick}))
        setAsking((current) => (current === token ? null : current))
      })
  }, [
    mode,
    phase,
    asking,
    flips,
    isShort,
    keywordsDone,
    session,
    reportsUsed,
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  ])

  // Autopilot: what its permissions let it do alone, once per flip.
  React.useEffect(() => {
    if (mode !== 'autopilot' || !phase) return
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
  }, [mode, phase, flips, picks, reportsUsed, reportsAllowed, send])

  // Autopilot's clock: the countdown and the latest submit move with time, not only with the validation's state.
  React.useEffect(() => {
    if (mode !== 'autopilot' || !step) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [mode, step])

  const end = sessionEnd({
    isShort,
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  })
  const countdownEnd = countdown.step === step ? countdown.end : null

  // Autopilot through the validation: random answers where the model gave none, the next step, the submit.
  React.useEffect(() => {
    if (mode !== 'autopilot' || !step) return
    if (step === 'shortFail' || step === 'longFail') {
      if (now - lastRetry.current >= RETRY_SUBMIT_MS) {
        lastRetry.current = now
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
        outOfTime: end - now - END_MARGIN_MS < MIN_FLIP_MS,
      }),
      now,
      guardAt: end - SUBMIT_GUARD_MS[isShort ? 'short' : 'long'],
      countdownEnd,
    })
    plan.events.forEach((event) => send(event))
    if (plan.countdownEnd !== countdownEnd)
      setCountdown({step, end: plan.countdownEnd})
  }, [mode, step, flips, picks, asking, now, end, isShort, countdownEnd, send])

  if (!mode) return null
  const toTake = answersToTake(flips, picks)
  return {
    mode,
    picks,
    asking,
    countdown:
      mode === 'autopilot' && countdownEnd
        ? Math.max(0, Math.ceil((countdownEnd - now) / 1000))
        : null,
    // A person takes over: the agent stops everywhere (the menu card resumes it).
    pause: () =>
      updateAgentSettings((s) => ({...s, paused: true})).catch(() => {}),
    takeRest: () => toTake.forEach(send),
    canTakeRest:
      mode === 'suggest' && phase !== 'keywords' && toTake.length > 0,
  }
}
