import {LIKE} from '../../social/contract'
import {validTipAmount} from '../../social/calls'

// The events that start an agent's run besides its schedule (B-255): a like, an answer, a tip or a private message
// to it after its read point, as the Social scan holds them.

/** How soon after an event's run another event may start one: the model's service bills each run. */
export const EVENT_MIN_MS = 5 * 60 * 1000

/**
 * Whether something of `events` ('like', 'answer', 'tip', 'message') came to `me` after block `point` and up to
 * `scanned`, from someone not in `blocked`.
 */
export function eventPending(
  events,
  {feed = [], me, conversations = [], blocked},
  {point, scanned}
) {
  if (!events.length || typeof point !== 'number') return false
  const isNew = (item) => item.height > point && item.height <= scanned
  const fromOther = (address) =>
    address !== me && !(blocked && blocked.has(address))
  let found = false
  const visit = (node, parent) => {
    if (found) return
    const mine = node.call.author === me
    if (
      events.includes('answer') &&
      parent &&
      parent.call.author === me &&
      fromOther(node.call.author) &&
      node.call.message !== LIKE &&
      isNew(node.call)
    )
      found = true
    if (
      mine &&
      events.includes('like') &&
      node.likeCalls.some((like) => fromOther(like.author) && isNew(like))
    )
      found = true
    if (
      mine &&
      events.includes('tip') &&
      node.tips.some(
        (tip) =>
          fromOther(tip.from) && isNew(tip) && validTipAmount(tip) !== null
      )
    )
      found = true
    node.replies.forEach((child) => visit(child, node))
  }
  feed.forEach((post) => visit(post, null))
  if (!found && events.includes('message'))
    found = conversations.some(
      (conversation) =>
        !conversation.group &&
        !conversation.isGroup &&
        conversation.others.length === 1 &&
        conversation.messages.some(
          (message) => fromOther(message.from) && isNew(message)
        )
    )
  return found
}
