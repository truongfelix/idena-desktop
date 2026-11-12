import * as React from 'react'
import {
  agentStatus,
  solveAgentFlip,
  stopAgentSolve,
} from '../../settings/agent/api'
import {
  answersToTake,
  appliedKey,
  autopilotEvents,
  flipDeadlineMs,
  flipsLeftToAsk,
  nextFlipToAsk,
  sessionEnd,
} from './picks'
import {availableReportsNumber} from '../utils'

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
 * The agent beside a validation screen. `flips` are the session's flips as shown, `phase` 'short' | 'long' |
 * 'keywords' | null (not solving). Returns null when the agent is off, else its mode ('suggest' | 'autopilot'),
 * its picks by hash, and takeRest() (Suggest: an answer for every flip left that has a pick).
 */
export function useAgentValidation({
  flips,
  phase,
  reportsUsed,
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

  React.useEffect(() => {
    live.current = true
    agentStatus()
      .then(({settings}) => {
        const {level} = settings.permissions.answerFlip
        if (
          live.current &&
          settings.enabled &&
          !settings.paused &&
          level !== 'off'
        )
          setMode(level === 'alone' ? 'autopilot' : 'suggest')
      })
      .catch(() => {})
    return () => {
      live.current = false
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
    const flip = nextFlipToAsk(flips, asked.current, {isShort})
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
      reportsLeft: availableReportsNumber(flips) - reportsUsed,
    }).forEach((event) => {
      applied.current.add(appliedKey(event))
      send(event)
    })
  }, [mode, phase, flips, picks, reportsUsed, send])

  if (!mode) return null
  const toTake = answersToTake(flips, picks)
  return {
    mode,
    picks,
    asking,
    takeRest: () => toTake.forEach(send),
    canTakeRest:
      mode === 'suggest' && phase !== 'keywords' && toTake.length > 0,
  }
}
