/**
 * The Social news the sidebar and the app's icons count: what others did on one's posts and was not seen yet,
 * the unread conversations, and the vouch offers waiting for an answer.
 */
export function socialNewsCount({
  unread = [],
  unreadConversations = 0,
  offersTo = [],
} = {}) {
  return unread.length + unreadConversations + offersTo.length
}
