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

// A picture shown from a blob URL, read back as JPEG base64: the app's content policy refuses fetch() of blob URLs,
// an <img> loads them.
function base64Of(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d').drawImage(image, 0, 0)
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

  React.useEffect(() => {
    let live = true
    agentStatus()
      .then(({settings}) => {
        const {level} = settings.permissions.answerFlip
        if (live && settings.enabled && !settings.paused && level !== 'off')
          setMode(level === 'alone' ? 'autopilot' : 'suggest')
      })
      .catch(() => {})
    return () => {
      live = false
      // Leaving the validation: the question in flight ends in the main process.
      stopAgentSolve().catch(() => {})
    }
  }, [])

  const isShort = phase === 'short'

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
    setAsking(flip.hash)
    const start = Date.now()
    agentFlip(flip, {isShort})
      .then((data) => solveAgentFlip(data, {reportsUsed, timeoutMs}))
      .then(
        (pick) => ({...pick, seconds: (Date.now() - start) / 1000}),
        () => ({failed: true})
      )
      .then((pick) => {
        setPicks((current) => ({...current, [flip.hash]: pick}))
        setAsking(null)
      })
  }, [
    mode,
    phase,
    asking,
    flips,
    isShort,
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
    }).forEach((event) => {
      applied.current.add(appliedKey(event))
      send(event)
    })
  }, [mode, phase, flips, picks, send])

  if (!mode) return null
  return {
    mode,
    picks,
    asking,
    takeRest: () => answersToTake(flips, picks).forEach(send),
    canTakeRest:
      mode === 'suggest' &&
      phase !== 'keywords' &&
      answersToTake(flips, picks).length > 0,
  }
}
