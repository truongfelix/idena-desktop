import React from 'react'
import {useRouter} from 'next/router'

// Each history entry of the window carries its place in the app's history: the first page 0, each push one more
// than the page it was made from, a replace the same. A page closes by going back only when a page of the app is
// behind it (B-108: closing by pushing the list made the way back reopen what was closed).
const INDEX = 'idenaIndex'

/** The place of the history entry whose state is `state`; 0 when it has none (the first page). */
export const historyIndexOf = (state) =>
  Number.isInteger(state?.[INDEX]) ? state[INDEX] : 0

// The last move in the history: 'push', 'replace' or 'pop' (back or forward), for the pages' scroll (Page).
let lastMove = 'push'

/** The last move in the window's history since it was numbered: 'push', 'replace' or 'pop'. */
export const lastHistoryMove = () => lastMove

/**
 * Numbers the entries of `history` (window.history) from now on: its push and replace keep Next's state; a back or
 * forward (`win`'s popstate) is noted as the last move.
 */
export function numberHistory(history, win = null) {
  if (history.idenaNumbered) return
  const push = history.pushState.bind(history)
  const replace = history.replaceState.bind(history)
  // eslint-disable-next-line no-param-reassign
  history.pushState = (state, title, url) => {
    lastMove = 'push'
    push({...state, [INDEX]: historyIndexOf(history.state) + 1}, title, url)
  }
  // eslint-disable-next-line no-param-reassign
  history.replaceState = (state, title, url) => {
    // Next's router replaces the entry it pops to: the move stays a pop until the next push.
    if (lastMove !== 'pop') lastMove = 'replace'
    replace({...state, [INDEX]: historyIndexOf(history.state)}, title, url)
  }
  // eslint-disable-next-line no-param-reassign
  history.idenaNumbered = true
  history.replaceState(history.state, '')
  lastMove = 'push'
  win?.addEventListener('popstate', () => {
    lastMove = 'pop'
  })
}

/** How to close the page whose entry has `state`: back to the app's page behind it, or replace it with a list. */
export const closeMove = (state) =>
  historyIndexOf(state) > 0 ? 'back' : 'replace'

/** Closes the current page: back where it was opened from, or to `listHref` when nothing of the app is behind it. */
export function useClosePage() {
  const router = useRouter()
  return React.useCallback(
    (listHref) => {
      if (closeMove(window.history.state) === 'back') router.back()
      else router.replace(listHref)
    },
    [router]
  )
}
