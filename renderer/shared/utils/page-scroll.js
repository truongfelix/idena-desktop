import React from 'react'
import {useRouter} from 'next/router'
import {lastHistoryMove} from './page-history'

// Each address's scroll position in its page, while the app runs: the way back shows a list where it was left
// (B-105: every view opened at its top, back included).
const positions = new Map()

/** How long a position is tried while the page's list loads, in frames (about 3 s). */
const RESTORE_FRAMES = 180

/**
 * Where a page's scroll goes after the history `move` to address `key`: back to its saved place after a back or
 * forward ('pop'), the top after a push, and nowhere (null) after a replace or a pop with no saved place.
 */
export function scrollTargetOf(move, key, saved = positions) {
  if (move === 'pop') return saved.has(key) ? saved.get(key) : null
  return move === 'push' ? 0 : null
}

/** Keeps the scroll of the page `ref` scrolls per address: saved as it scrolls, restored on the way back. */
export function usePageScroll(ref) {
  const {asPath} = useRouter()

  // Attached at the commit: a list that shrinks while the view changes cannot write over the last view's place.
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const save = () => positions.set(asPath, element.scrollTop)
    element.addEventListener('scroll', save, {passive: true})
    return () => element.removeEventListener('scroll', save)
  }, [asPath, ref])

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const target = scrollTargetOf(lastHistoryMove(), asPath)
    if (target === null) return undefined
    // eslint-disable-next-line no-param-reassign
    element.scrollTop = target
    if (target === 0) return undefined
    // The list may still be loading: try again each frame until it is long enough, or the user scrolls.
    let frame = 0
    let stopped = false
    const stop = () => {
      stopped = true
    }
    element.addEventListener('wheel', stop, {passive: true})
    const retry = () => {
      if (stopped) return
      // eslint-disable-next-line no-param-reassign
      element.scrollTop = target
      frame += 1
      if (Math.abs(element.scrollTop - target) > 1 && frame < RESTORE_FRAMES)
        requestAnimationFrame(retry)
    }
    requestAnimationFrame(retry)
    return () => {
      stop()
      element.removeEventListener('wheel', stop)
    }
  }, [asPath, ref])
}
