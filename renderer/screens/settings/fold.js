import * as React from 'react'

// Whether a folding section is open (B-250): remembered on this computer, per section, a convenience only (no
// storage, or a value it did not write: the section's default).

export const foldKey = (id) => `fold.${id}`

/** The section's state as stored: '1' open, '0' folded, anything else (or no storage) its default. */
export function readFold(storage, id, defaultOpen) {
  try {
    const value = storage.getItem(foldKey(id))
    if (value === '1') return true
    if (value === '0') return false
  } catch {
    // No storage: the default.
  }
  return defaultOpen
}

export function writeFold(storage, id, isOpen) {
  try {
    storage.setItem(foldKey(id), isOpen ? '1' : '0')
  } catch {
    // Not kept: the section opens as its default next time.
  }
}

const browserStorage = () =>
  typeof window === 'undefined' ? null : window.localStorage

/** [isOpen, toggle] of the section `id`. */
export function useFold(id, defaultOpen = true) {
  const [isOpen, setIsOpen] = React.useState(() =>
    readFold(browserStorage(), id, defaultOpen)
  )
  const toggle = React.useCallback(
    () =>
      setIsOpen((open) => {
        writeFold(browserStorage(), id, !open)
        return !open
      }),
    [id]
  )
  return [isOpen, toggle]
}
