// The editor as a step of the history (B-107): opening it adds a `compose` entry, so the way back closes it, as
// Cancel does (the text stays for the next draft), and Cancel or a sent post step back to where it was opened.

/** The address's query with the editor open. */
export const withCompose = (query) => ({...query, compose: '1'})

/**
 * What the Social page does when the draft or the address changes: 'push' the editor's entry for a draft just
 * opened, 'cancel' the draft when the way back left the editor's entry, 'back' out of the entry when the draft
 * closed (Cancel, sent) or the entry was reached without one (forward), or nothing (null).
 */
export function editorMove({hadDraft, hasDraft, hadCompose, hasCompose}) {
  if (hasDraft && !hadDraft && !hasCompose) return 'push'
  if (hasDraft && hadCompose && !hasCompose) return 'cancel'
  if (!hasDraft && hasCompose && (hadDraft || !hadCompose)) return 'back'
  return null
}

/**
 * Where the editor of `draft` opens: under the thread `postId` shows (B-169, as on the phone: the thread scrolls
 * above the editor), with the answered post, reply or comment marked, when the draft answers something in that
 * thread; on its own page otherwise (a new post, a thread not shown). Gives the id to mark, or null.
 */
export function replyFocusInThread(draft, postId, hasThread, idKey) {
  if (!draft || !hasThread || postId === null) return null
  const answered = draft.target?.replyTo
  if (!draft.target?.level || answered === null || answered === undefined)
    return null
  return idKey(answered)
}

/**
 * How far to scroll so that an item of the thread shows just above the editor pinned under it: `item` and
 * `editorTop` are window coordinates, `viewTop` the top of the scrolling area. 0 when it already shows there.
 */
export function scrollToShowAbove(item, editorTop, viewTop, margin = 16) {
  const room = editorTop - viewTop - 2 * margin
  // An item taller than the room shows from its top.
  if (item.bottom - item.top > room) return item.top - viewTop - margin
  if (item.bottom > editorTop - margin)
    return item.bottom - (editorTop - margin)
  if (item.top < viewTop + margin) return item.top - (viewTop + margin)
  return 0
}
