import {isLike} from './calls'
import {idKey} from './feed'
import {activeBan, normalHex} from './moderation'

// What Community moderation hides in the feed, by the idena.social website's rules (docs/moderation.md, "What gets
// hidden"): a post made while its author is banned is never shown; a post made before the ban, or hidden one by one,
// stays as a placeholder (no text, no media, no author, no actions) while a reply or comment under it is still shown,
// and leaves otherwise. Likes are never hidden (a "like" with media is no like). Tips and likes keep counting.

/**
 * Why a call (a post, reply or comment) is hidden: {kind: 'duringBan'} (made while its author is banned: never
 * shown), {kind: 'hidden', reason} (hidden one by one, or its author banned since), or null.
 */
export function hiddenStatus(call, state, epoch) {
  if (isLike(call) && !call.hasMedia) return null
  const ban = activeBan(state, call.author, epoch)
  if (ban && call.time >= ban.since) return {kind: 'duringBan'}
  const hidden = state.hidden.get(normalHex(call.hash))
  if (hidden) return {kind: 'hidden', reason: hidden.reason}
  if (ban) return {kind: 'hidden', reason: ban.reason}
  return null
}

/**
 * A profile (profiles.js) as shown while its address is banned: out of good standing, without its name, bio and
 * picture (the website shows only the address and the robot), `banned` holding the ban; else the same profile.
 */
export function moderatedProfile(profile, address, state, epoch) {
  const ban = activeBan(state, address, epoch)
  if (!ban) return profile
  return {
    ...(profile || {}),
    inStanding: false,
    name: '',
    bio: '',
    picture: '',
    banned: ban,
  }
}

/** A placeholder's call: the same post, without what it says or shows, marked `moderated`. */
const emptied = (call) => ({
  ...call,
  moderated: true,
  message: '',
  hasMedia: false,
  media: '',
  mediaType: '',
})

/**
 * A node as shown: null when it leaves (made during a ban, or hidden with nothing shown under it), a placeholder
 * (`moderated: {reason}`, its call emptied) when hidden with something still shown under it, else itself.
 * `children` are the node's answers as already resolved (null for those that leave).
 */
function resolveNode(node, children, state, epoch) {
  const status = hiddenStatus(node.call, state, epoch)
  if (!status) return {...node, replies: children}
  if (status.kind === 'duringBan') return null
  const kept = children.filter(Boolean)
  if (kept.length === 0) return null
  return {
    ...node,
    call: emptied(node.call),
    moderated: {reason: status.reason},
    replies: children,
  }
}

/**
 * A reply's comments as shown. A comment's answers are the comments that reply to it (call.replyTo); a hidden
 * comment stays as a placeholder while one of them is shown. A loop of answers counts as nothing shown.
 */
function resolveComments(comments, state, epoch) {
  const byId = new Map(comments.map((c) => [idKey(c.id), c]))
  const answers = new Map()
  for (const comment of comments) {
    const parent = idKey(comment.call.replyTo)
    if (byId.has(parent) && parent !== idKey(comment.id)) {
      if (!answers.has(parent)) answers.set(parent, [])
      answers.get(parent).push(comment)
    }
  }
  const shown = new Map()
  const resolving = new Set()
  const shows = (comment) => {
    const key = idKey(comment.id)
    if (shown.has(key)) return shown.get(key)
    if (resolving.has(key)) return false
    resolving.add(key)
    const status = hiddenStatus(comment.call, state, epoch)
    let result
    if (!status) result = true
    else if (status.kind === 'duringBan') result = false
    else result = (answers.get(key) || []).some(shows)
    resolving.delete(key)
    shown.set(key, result)
    return result
  }
  return comments.map((comment) => {
    if (!shows(comment)) return null
    const status = hiddenStatus(comment.call, state, epoch)
    return status
      ? {
          ...comment,
          call: emptied(comment.call),
          moderated: {reason: status.reason},
        }
      : comment
  })
}

/**
 * The feed (socialFeed's nodes: posts, their replies, each reply's comments) as Community moderation shows it:
 * what leaves is taken out, placeholders are marked `moderated` with their text and media gone. The same feed
 * when nothing is moderated.
 */
export function moderatedFeed(feed, state, epoch) {
  if (state.bans.size === 0 && state.hidden.size === 0) return feed
  const replyOf = (reply) =>
    resolveNode(
      reply,
      resolveComments(reply.replies, state, epoch),
      state,
      epoch
    )
  return feed
    .map((post) => resolveNode(post, post.replies.map(replyOf), state, epoch))
    .filter(Boolean)
    .map((post) => ({
      ...post,
      replies: post.replies
        .filter(Boolean)
        .map((reply) => ({...reply, replies: reply.replies.filter(Boolean)})),
    }))
}
