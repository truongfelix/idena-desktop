import {idKey} from './feed'
import {oneLine, takeWhole} from './people'
import {postTopic} from './topics'

// What the user hides, on this computer only (never on chain: the posts stay public): blocked accounts (a person's
// `blocked` mark), hidden words, posts hidden one by one and blocked topics. A blocked account's posts, replies,
// comments, likes and tips leave the lists, the threads, the notifications and the messages. A post hidden, or whose
// text has a hidden word, leaves the lists and the notifications; inside a thread, such a reply or comment shows
// folded. A blocked topic's posts leave the lists. The identity's own posts are never hidden. The same rules as the
// phone app (SocialHiding.kt).

/** A hidden word or phrase is at most this long. */
export const MAX_HIDDEN_WORD = 60

/** At most this many hidden words. */
export const MAX_HIDDEN_WORDS = 300

/** A text as a hidden word or phrase: one line, spaces collapsed, at most MAX_HIDDEN_WORD characters; null if empty. */
export function cleanHiddenWord(text) {
  if (typeof text !== 'string') return null
  return takeWhole(oneLine(text), MAX_HIDDEN_WORD).trim() || null
}

/** A text lowercase, without accents, spaces collapsed: what a hidden word is matched against. */
export const matchForm = (text) =>
  String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .replace(/\s+/g, ' ')

const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

/**
 * The hidden words and phrases: a text matches when it holds one as a whole word (not inside a longer word), with
 * case and accents ignored.
 */
export function wordFilter(words = []) {
  const forms = [
    ...new Set(words.map(cleanHiddenWord).filter(Boolean).map(matchForm)),
  ]
  const patterns = forms.map(
    (form) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(form)}(?![\\p{L}\\p{N}])`,
        'u'
      )
  )
  const matches = (text) => {
    if (patterns.length === 0 || !text) return false
    const form = matchForm(text)
    return patterns.some((pattern) => pattern.test(form))
  }
  return {
    isEmpty: patterns.length === 0,
    matches,
    // Whether a call's text, when in the transaction, has a hidden word; never for `me`'s own posts.
    hides: (call, me) =>
      call.author !== me &&
      !call.message.startsWith('ipfs://') &&
      matches(call.message),
  }
}

/**
 * What is hidden: the accounts blocked (`blocked`, lowercase), the hidden words (`words`), the posts, replies and
 * comments hidden one by one (by transaction hash, `posts`) and the topics blocked (`topics`).
 */
export function hiding({
  blocked = new Set(),
  words = wordFilter(),
  posts = new Set(),
  topics = new Set(),
} = {}) {
  return {
    blocked,
    words,
    posts,
    topics,
    isEmpty:
      blocked.size === 0 &&
      words.isEmpty &&
      posts.size === 0 &&
      topics.size === 0,
  }
}

export const NO_HIDING = hiding()

/** Whether a call's text is hidden (hidden one by one, or with a hidden word in the transaction); never `me`'s. */
export const hidesText = (hidden, call, me) =>
  call.author !== me &&
  (hidden.posts.has(String(call.hash).toLowerCase()) ||
    hidden.words.hides(call, me))

function withoutBlocked(node, blocked, me) {
  if (blocked.size === 0) return node
  const replies = node.replies.filter(
    ({call}) => call.author === me || !blocked.has(call.author)
  )
  // Comments answering a removed comment leave with it.
  const removed = new Set(
    node.replies.filter((n) => !replies.includes(n)).map(({id}) => idKey(id))
  )
  let kept = replies
  for (;;) {
    const next = kept.filter(
      ({call}) => !removed.has(idKey(call.replyTo)) || call.author === me
    )
    if (next.length === kept.length) break
    kept
      .filter((n) => !next.includes(n))
      .forEach(({id}) => removed.add(idKey(id)))
    kept = next
  }
  return {
    ...node,
    likeCalls: node.likeCalls.filter(({author}) => !blocked.has(author)),
    tips: node.tips.filter(({from}) => !blocked.has(from)),
    replies: kept.map((reply) => withoutBlocked(reply, blocked, me)),
  }
}

/**
 * The feed as shown: the posts of blocked accounts left out with their whole thread, their replies and comments
 * (with what answers them) left out of the others' threads, their likes and tips taken off; the posts hidden, with
 * a hidden word or in a blocked topic left out. `me`'s posts always stay.
 */
export function visibleFeed(feed, hidden, me) {
  if (hidden.isEmpty) return feed
  const {blocked} = hidden
  return feed
    .filter(
      (node) =>
        node.call.author === me ||
        (!blocked.has(node.call.author) &&
          !hidesText(hidden, node.call, me) &&
          !hidden.topics.has(postTopic(node)))
    )
    .map((node) => withoutBlocked(node, blocked, me))
}

/** The notifications without those made by a blocked account, nor answers hidden (hidesText). */
export const visibleActivity = (items, hidden, me) =>
  hidden.isEmpty
    ? items
    : items.filter(
        ({actor, answer}) =>
          !hidden.blocked.has(actor) &&
          !(answer && hidesText(hidden, answer, me))
      )

/**
 * The thread of post `postId` (idKey) as shown when opened: from the whole `feed`, since a post hidden, with a
 * hidden word or in a blocked topic still opens (folded); without what blocked accounts wrote, and none for their
 * posts.
 */
export function threadPost(feed, postId, hidden, me) {
  const node = feed.find(({id}) => idKey(id) === postId)
  if (!node) return null
  return visibleFeed([node], hiding({blocked: hidden.blocked}), me)[0] || null
}

/** The conversations without those where a blocked account takes part. */
export const visibleConversations = (conversations, blocked) =>
  blocked.size === 0
    ? conversations
    : conversations.filter(({others}) => !others.some((a) => blocked.has(a)))

/** A transaction hash as the posts carry it: 0x and 64 hex digits, lowercase; null when it is not one. */
export function txHashOf(text) {
  if (typeof text !== 'string') return null
  const hash = text.trim().toLowerCase()
  return /^0x[0-9a-f]{64}$/.test(hash) ? hash : null
}

/**
 * The posts, replies and comments hidden one by one (`hashes`, lowercase), newest first: {hash, threadId, node}
 * where the feed holds them (threadId, the thread to open); {hash} alone where it does not, first, as the phone's.
 */
export function hiddenEntries(feed, hashes) {
  const found = new Map()
  const visit = (node, threadId) => {
    const hash = String(node.call.hash).toLowerCase()
    if (hashes.includes(hash)) found.set(hash, {hash, threadId, node})
    node.replies.forEach((reply) => visit(reply, threadId))
  }
  feed.forEach((node) => visit(node, node.id))
  const height = ({node}) => (node ? node.call.height : Infinity)
  return hashes
    .map((hash) => found.get(hash) || {hash})
    .sort((x, y) => height(y) - height(x) || 0)
}
