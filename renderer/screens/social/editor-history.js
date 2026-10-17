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
