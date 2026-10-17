import React from 'react'

// What a Social view shows that its address does not hold (the feed's search, a profile's list, how many items
// Show more opened), kept while the app runs: a view rebuilt on the way back finds it again (B-106).
const kept = new Map()

/** The value kept at `key`, or `initial`. */
export const keptValue = (key, initial) =>
  kept.has(key) ? kept.get(key) : initial

/** Keeps `value` at `key`. */
export const keep = (key, value) => kept.set(key, value)

/** As React.useState, its value kept at `key` (a new key starts at `initial`). */
export function useKeptState(key, initial) {
  const [, rerender] = React.useReducer((n) => n + 1, 0)
  const value = keptValue(key, initial)
  const setValue = React.useCallback(
    (next) => {
      keep(
        key,
        typeof next === 'function' ? next(keptValue(key, initial)) : next
      )
      rerender()
    },
    [initial, key]
  )
  return [value, setValue]
}
