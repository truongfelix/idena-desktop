/**
 * The history move a key press asks for, as in a browser: Alt+Left / Alt+Right on Windows and Linux, Cmd+[ / Cmd+]
 * (and Cmd+Left / Cmd+Right) on macOS. 'back', 'forward', or null for any other key.
 */
export function historyMoveOf(event, isMac) {
  const {key, altKey, metaKey, ctrlKey, shiftKey} = event
  if (ctrlKey || shiftKey) return null
  if (isMac) {
    if (!metaKey || altKey) return null
    if (key === '[' || key === 'ArrowLeft') return 'back'
    if (key === ']' || key === 'ArrowRight') return 'forward'
    return null
  }
  if (!altKey || metaKey) return null
  if (key === 'ArrowLeft') return 'back'
  if (key === 'ArrowRight') return 'forward'
  return null
}
