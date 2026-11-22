import React from 'react'
import {persistValidationState} from '../utils'

/** The longest a change of the validation waits before it is saved (B-303). */
export const SAVE_INTERVAL_MS = 1000

// Sub-states that move without changing where the validation stands: the flip shown and the fetching of flips and
// keywords (polling every few seconds).
const MOVING_PARTS = new Set(['nav', 'fetch'])

/**
 * Where the validation stands (a session, a submit, its end): the machine's state value without the flip shown nor
 * the fetching, as JSON. A change of it is saved at once.
 */
export function positionOf(value) {
  const strip = (part) => {
    if (part === null || typeof part !== 'object') return part
    return Object.fromEntries(
      Object.entries(part)
        .filter(([key]) => !MOVING_PARTS.has(key))
        .map(([key, inner]) => [key, strip(inner)])
    )
  }
  return JSON.stringify(strip(value))
}

/**
 * Saves the states pushed (B-303): at once when `urgent`, else the last one `intervalMs` after the end of the save
 * before, never at the moment of the change. Each save writes the whole state to disk and waits for it there, on the
 * window's thread: saving at every change (a tap on next, an answer, a flip loaded) froze the screen for seconds on
 * a busy HDD. `flush()` writes what waits. `now` only moves forward: a clock set back does not hold the saves.
 */
export function createSaver({
  save,
  intervalMs = SAVE_INTERVAL_MS,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let pending = null
  let timer = null
  let lastAt = -Infinity

  const write = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    if (pending === null) return
    const state = pending
    pending = null
    save(state)
    // From the end of the save: a slow disk leaves the window free between two saves.
    lastAt = now()
  }

  return {
    push(state, urgent = false) {
      pending = state
      if (urgent) {
        write()
        return
      }
      if (timer === null)
        timer = setTimer(write, Math.max(0, lastAt + intervalMs - now()))
    },
    flush: write,
  }
}

/** The validation page's saving of its machine's state: see createSaver; what waits is written when the page leaves. */
export function useValidationSave(state) {
  const saver = React.useRef(null)
  if (saver.current === null)
    saver.current = createSaver({save: persistValidationState})
  const position = React.useRef(null)

  React.useEffect(() => {
    const at = positionOf(state.value)
    const urgent = at !== position.current
    position.current = at
    saver.current.push(state, urgent)
  }, [state])

  React.useEffect(() => {
    const flush = () => saver.current.flush()
    // Hidden, the window's timers slow down: what waits is written then, not a minute later.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHidden)
      flush()
    }
  }, [])
}
