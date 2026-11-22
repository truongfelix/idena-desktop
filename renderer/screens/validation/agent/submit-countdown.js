import * as React from 'react'

/** Whole seconds left until `end` (ms) at `now`, never below 0. */
export function secondsLeft(end, now) {
  return Math.max(0, Math.ceil((end - now) / 1000))
}

/**
 * The seconds left before Autopilot submits, counted down by this hook alone (B-302): only the text that shows it
 * is drawn again each second, not the validation screen.
 */
export function useSecondsLeft(end) {
  const [seconds, setSeconds] = React.useState(() =>
    secondsLeft(end, Date.now())
  )
  React.useEffect(() => {
    setSeconds(secondsLeft(end, Date.now()))
    const timer = setInterval(
      () => setSeconds(secondsLeft(end, Date.now())),
      1000
    )
    return () => clearInterval(timer)
  }, [end])
  return seconds
}

/** `children(seconds)`: what shows the seconds left before `end`. */
export function SubmitCountdown({end, children}) {
  return children(useSecondsLeft(end))
}
