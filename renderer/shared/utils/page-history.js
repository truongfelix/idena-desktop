import React from 'react'
import {useRouter} from 'next/router'

// Each history entry of the window carries its place in the app's history: the first page 0, each push one more
// than the page it was made from, a replace the same. A page closes by going back only when a page of the app is
// behind it (B-108: closing by pushing the list made the way back reopen what was closed).
const INDEX = 'idenaIndex'

/** The place of the history entry whose state is `state`; 0 when it has none (the first page). */
export const historyIndexOf = (state) =>
  Number.isInteger(state?.[INDEX]) ? state[INDEX] : 0

/** Numbers the entries of `history` (window.history) from now on: its push and replace keep Next's state. */
export function numberHistory(history) {
  if (history.idenaNumbered) return
  const push = history.pushState.bind(history)
  const replace = history.replaceState.bind(history)
  // eslint-disable-next-line no-param-reassign
  history.pushState = (state, title, url) =>
    push({...state, [INDEX]: historyIndexOf(history.state) + 1}, title, url)
  // eslint-disable-next-line no-param-reassign
  history.replaceState = (state, title, url) =>
    replace({...state, [INDEX]: historyIndexOf(history.state)}, title, url)
  // eslint-disable-next-line no-param-reassign
  history.idenaNumbered = true
  history.replaceState(history.state, '')
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
