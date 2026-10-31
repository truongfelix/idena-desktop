import React from 'react'

/** The height a growing text box takes: its content's height, at least `min` and at most `max` (pixels). */
export function grownHeight(contentHeight, min, max) {
  return Math.min(Math.max(contentHeight, min), max)
}

/**
 * Makes the textarea `ref` points to grow with its text from `min` pixels up to `maxShare` of the window's height,
 * then scroll. Runs again each time `value` changes.
 */
export function useAutoGrow(ref, value, {min = 240, maxShare = 0.6} = {}) {
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    // Let the box shrink first, so its scroll height is the text's own height.
    element.style.height = 'auto'
    const max = Math.max(min, Math.round(window.innerHeight * maxShare))
    element.style.height = `${grownHeight(element.scrollHeight, min, max)}px`
  }, [ref, value, min, maxShare])
}
