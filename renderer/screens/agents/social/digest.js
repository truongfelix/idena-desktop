import {LIKE} from '../../social/contract'
import {postTargets} from '../../social/feed'
import {shortAddress} from '../../social/people'
import {validTipAmount} from '../../social/calls'

// What an agent reads on Idena Social when it runs (B-239): what came after its read point (a block height), and
// only what its actions need. Each item gets a label (p1, c1) that its answer names; the app keeps what each label
// stands for, so the model can act only on what it was shown. Texts are cut, other people's private names are never
// sent (only names claimed in the profiles contract), and a text on IPFS is said, not fetched.

/** The most items of each kind a run reads, and how long one text may be. */
export const MAX_NEW_POSTS = 20
export const MAX_ANSWERS = 20
export const MAX_CONVERSATIONS = 10
export const MAX_TIPS = 30
/** Its own last posts it reads, to go on from them (a numbered series, what it said already). */
export const OWN_POSTS_SHOWN = 10
export const MESSAGES_SHOWN = 5
export const MAX_TEXT = 500
/** A first run reads about the last day of blocks (20 s each). */
export const FIRST_RUN_BLOCKS = 4320

/** A text as the model reads it: on one quote, cut, a text on IPFS or a picture only named. */
export function shownText(message, hasMedia = false) {
  const value = String(message || '')
  const text = value.startsWith('ipfs://')
    ? '[a text stored on IPFS, not read]'
    : value.replace(/\s+/gu, ' ').trim()
  const cut = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
  return hasMedia ? `${cut} [with a picture or a file]`.trim() : cut
}

/** Every node of the feed under `node`, with the post it is in. */
function walk(feed) {
  const out = []
  const visit = (node, post, parent) => {
    out.push({node, post, parent})
    node.replies.forEach((child) => visit(child, post, node))
  }
  feed.forEach((post) => visit(post, post, null))
  return out
}

/**
 * Where a run's reading ends: the scanned block, or before the block of the first item left out; when an item of that
 * same block was shown, at that block (its others are lost rather than one shown twice, and acted on twice).
 */
function readUpTo(leftOut, lastHeight, from, scanned) {
  if (!leftOut) return scanned
  if (lastHeight === leftOut.height) return leftOut.height
  return Math.max(from, leftOut.height - 1)
}

/** The most characters of a run's input: below what the main process sends the model (MAX_INPUT_TEXT, 20,000). */
export const MAX_DIGEST = 15000

/**
 * The digest of a run: `social` is the Social state (feed, me, conversations, profiles' claimed `names`, blocked
 * addresses `blocked`), `held` the Social actions the agent may do (not Off), `point` its read point (null: a first
 * run), `scanned` the last block the Social scan read (the feed holds nothing after it). The new items are taken
 * oldest first, within each kind's cap and MAX_DIGEST; the first one left out ends what is read (`readTo` stops
 * before its block), so the next run shows it. Returns {text, labels, empty, readTo}: the model's input, what each
 * label stands for ({kind: 'post', node, post, target, author} or {kind: 'chat', conversation, others}), whether
 * there is anything new, and the block it read up to.
 */
export function socialDigest(social, held, {point, scanned}) {
  const {feed = [], me, names = {}, conversations = [], blocked} = social
  const isBlocked = (address) => Boolean(blocked && blocked.has(address))
  const from =
    point === null || point === undefined ? scanned - FIRST_RUN_BLOCKS : point
  const isNew = (item) => item.height > from && item.height <= scanned
  const name = (address) => names[address] || shortAddress(address)
  const targets = postTargets(feed)
  const onPosts = held.some((one) =>
    ['reply', 'like', 'tip', 'message'].includes(one)
  )

  // Every new item, each with the block that makes it new.
  const candidates = []
  if (onPosts)
    walk(feed)
      .filter(
        ({node, parent}) =>
          parent &&
          parent.call.author === me &&
          node.call.author !== me &&
          !isBlocked(node.call.author) &&
          typeof node.id === 'number' &&
          isNew(node.call) &&
          node.call.message !== LIKE
      )
      .forEach((one) =>
        candidates.push({kind: 'answer', height: one.node.call.height, ...one})
      )
  if (held.length)
    feed
      .filter(
        ({id, call}) =>
          typeof id === 'number' &&
          call.author !== me &&
          !isBlocked(call.author) &&
          isNew(call)
      )
      .forEach((node) =>
        candidates.push({kind: 'post', height: node.call.height, node})
      )
  if (held.includes('message'))
    conversations.forEach((conversation) => {
      if (
        conversation.isGroup ||
        conversation.group ||
        conversation.others.length !== 1 ||
        conversation.others[0] === me ||
        isBlocked(conversation.others[0])
      )
        return
      const fresh = conversation.messages.filter(
        (message) => message.from !== me && isNew(message)
      )
      if (fresh.length)
        // At its newest message: a cut before it leaves the whole conversation for the next run, never half.
        candidates.push({
          kind: 'chat',
          height: fresh[fresh.length - 1].height,
          conversation,
        })
    })
  // The tips to its posts, replies and comments: who, how much, on what.
  if (held.length)
    walk(feed)
      .filter(({node}) => node.call.author === me)
      .forEach(({node}) =>
        node.tips
          .filter(
            (tip) => tip.from !== me && !isBlocked(tip.from) && isNew(tip)
          )
          .forEach((tip) =>
            candidates.push({kind: 'tip', height: tip.height, tip, node})
          )
      )
  candidates.sort((a, b) => a.height - b.height)

  const labels = new Map()
  let posts = 0
  let chats = 0
  const label = (node, post) => {
    const found = [...labels.entries()].find(
      ([, item]) => item.kind === 'post' && item.node.id === node.id
    )
    if (found) return found[0]
    posts += 1
    const id = `p${posts}`
    labels.set(id, {
      kind: 'post',
      node,
      post,
      target: targets.get(node.id) || null,
      author: node.call.author,
    })
    return id
  }
  const caps = {
    answer: MAX_ANSWERS,
    post: MAX_NEW_POSTS,
    chat: MAX_CONVERSATIONS,
    tip: MAX_TIPS,
  }
  const counts = {answer: 0, post: 0, chat: 0, tip: 0}
  const lines = {answer: [], post: [], chat: [], tip: []}
  // A person (a tipper) once: the agent may write to them.
  let people = 0
  const personLabel = (address) => {
    const found = [...labels.entries()].find(
      ([, item]) => item.kind === 'person' && item.others[0] === address
    )
    if (found) return found[0]
    people += 1
    const id = `u${people}`
    labels.set(id, {kind: 'person', others: [address]})
    return id
  }
  // Its own last posts: read first, whatever the point (no label: nothing to act on).
  const own = held.includes('post')
    ? feed
        .filter(({call}) => call.author === me && call.height <= scanned)
        .slice(0, OWN_POSTS_SHOWN)
        .reverse()
        .map(({call}) => `- "${shownText(call.message, call.hasMedia)}"`)
    : []
  let {length} = own.join('\n')
  let leftOut = null
  let lastHeight = null
  // eslint-disable-next-line no-restricted-syntax
  for (const item of candidates) {
    if (counts[item.kind] >= caps[item.kind]) {
      leftOut = item
      break
    }
    const before = new Map(labels)
    const kept = {posts, chats, people}
    let text
    if (item.kind === 'answer') {
      const yours = label(item.parent, item.post)
      const id = label(item.node, item.post)
      text = `${id} by ${name(
        item.node.call.author
      )}, answering your ${yours} ("${shownText(
        item.parent.call.message,
        item.parent.call.hasMedia
      )}"): "${shownText(item.node.call.message, item.node.call.hasMedia)}"`
    } else if (item.kind === 'post') {
      const id = label(item.node, item.node)
      const likes = item.node.likeCalls.length
      text = `${id} by ${name(item.node.call.author)}${
        likes ? ` (${likes} like${likes > 1 ? 's' : ''})` : ''
      }: "${shownText(item.node.call.message, item.node.call.hasMedia)}"`
    } else if (item.kind === 'tip') {
      const id = personLabel(item.tip.from)
      const amount = validTipAmount(item.tip)
      text = `${id} ${name(
        item.tip.from
      )} tipped you ${amount} iDNA for "${shownText(
        item.node.call.message,
        item.node.call.hasMedia
      )}"`
    } else {
      chats += 1
      const id = `c${chats}`
      const {conversation} = item
      labels.set(id, {kind: 'chat', conversation, others: conversation.others})
      text = [
        `${id} with ${name(conversation.others[0])}:`,
        ...conversation.messages
          .slice(-MESSAGES_SHOWN)
          .map(
            (message) =>
              `  ${
                message.from === me ? 'you' : name(message.from)
              }: "${shownText(message.text, message.hasMedia)}"`
          ),
      ].join('\n')
    }
    if (length + text.length + 1 > MAX_DIGEST) {
      // Not shown: its labels go, so the model cannot name it.
      labels.clear()
      before.forEach((value, key) => labels.set(key, value))
      posts = kept.posts
      chats = kept.chats
      people = kept.people
      leftOut = item
      break
    }
    length += text.length + 1
    lastHeight = item.height
    counts[item.kind] += 1
    lines[item.kind].push(text)
  }

  const sections = [
    ['Tips to you:', lines.tip],
    ['Answers to you:', lines.answer],
    ['New posts:', lines.post],
    ['Private messages to you:', lines.chat],
  ]
    .filter(([, list]) => list.length)
    .map(([title, list]) => [title, ...list].join('\n'))
  const empty = sections.length === 0
  const ownText = own.length
    ? `Your last posts, the newest last:\n${own.join('\n')}\n\n`
    : ''
  return {
    text: `${ownText}${
      empty
        ? 'Nothing new since your last run.'
        : `Since your last run:\n\n${sections.join('\n\n')}`
    }`,
    labels,
    empty,
    readTo: readUpTo(leftOut, lastHeight, from, scanned),
  }
}
