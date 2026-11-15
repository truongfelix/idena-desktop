import {LIKE} from '../../social/contract'
import {postTargets} from '../../social/feed'
import {shortAddress} from '../../social/people'

// What an agent reads on Idena Social when it runs (B-239): what came after its read point (a block height), and
// only what its actions need. Each item gets a label (p1, c1) that its answer names; the app keeps what each label
// stands for, so the model can act only on what it was shown. Texts are cut, other people's private names are never
// sent (only names claimed in the profiles contract), and a text on IPFS is said, not fetched.

/** The most items of each kind a run reads, and how long one text may be. */
export const MAX_NEW_POSTS = 20
export const MAX_ANSWERS = 20
export const MAX_CONVERSATIONS = 10
export const MESSAGES_SHOWN = 5
export const MAX_TEXT = 500
/** A first run reads about the last day of blocks (20 s each). */
export const FIRST_RUN_BLOCKS = 4320

const after = (point) => (item) => item.height > point

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
 * The digest of a run: `social` is the Social state (feed, me, conversations, profiles' claimed `names`, blocked
 * addresses `blocked`), `held` the Social actions the agent may do (not Off), `point` its read point (null: a
 * first run), `head` the chain's last block. Returns {text, labels, empty, readTo}: the model's input, what each
 * label stands for ({kind: 'post', node, post, target, author} or {kind: 'chat', conversation, others}), whether
 * there is anything new, and the block it read up to.
 */
export function socialDigest(social, held, {point, head}) {
  const {feed = [], me, names = {}, conversations = [], blocked} = social
  const isBlocked = (address) => Boolean(blocked && blocked.has(address))
  const from =
    point === null || point === undefined ? head - FIRST_RUN_BLOCKS : point
  const name = (address) => names[address] || shortAddress(address)
  const targets = postTargets(feed)
  const labels = new Map()
  const sections = []
  let posts = 0
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
  const onPosts = held.some((name_) =>
    ['reply', 'like', 'tip', 'message'].includes(name_)
  )

  // The answers to its own posts, replies and comments: what it is most likely to answer.
  if (onPosts) {
    const answers = walk(feed)
      .filter(
        ({node, parent}) =>
          parent &&
          parent.call.author === me &&
          node.call.author !== me &&
          !isBlocked(node.call.author) &&
          typeof node.id === 'number' &&
          after(from)(node.call) &&
          node.call.message !== LIKE
      )
      .slice(-MAX_ANSWERS)
    if (answers.length) {
      const lines = ['Answers to you:']
      answers.forEach(({node, parent, post}) => {
        const yours = label(parent, post)
        const id = label(node, post)
        lines.push(
          `${id} by ${name(
            node.call.author
          )}, answering your ${yours} ("${shownText(
            parent.call.message,
            parent.call.hasMedia
          )}"): "${shownText(node.call.message, node.call.hasMedia)}"`
        )
      })
      sections.push(lines.join('\n'))
    }
  }

  // The new posts of others, the newest first.
  if (held.length) {
    const fresh = feed
      .filter(
        ({id, call}) =>
          typeof id === 'number' &&
          call.author !== me &&
          !isBlocked(call.author) &&
          after(from)(call)
      )
      .slice(0, MAX_NEW_POSTS)
    if (fresh.length) {
      const lines = ['New posts:']
      fresh.forEach((node) => {
        const id = label(node, node)
        const likes = node.likeCalls.length
        lines.push(
          `${id} by ${name(node.call.author)}${
            likes ? ` (${likes} like${likes > 1 ? 's' : ''})` : ''
          }: "${shownText(node.call.message, node.call.hasMedia)}"`
        )
      })
      sections.push(lines.join('\n'))
    }
  }

  // The private conversations (one other person: no group) with a message to it since the point.
  if (held.includes('message')) {
    const chats = conversations
      .filter(
        (conversation) =>
          !conversation.isGroup &&
          !conversation.group &&
          conversation.others.length === 1 &&
          conversation.others[0] !== me &&
          !isBlocked(conversation.others[0]) &&
          conversation.messages.some(
            (message) => message.from !== me && after(from)(message)
          )
      )
      .slice(0, MAX_CONVERSATIONS)
    if (chats.length) {
      const lines = ['Private messages to you:']
      chats.forEach((conversation, i) => {
        const id = `c${i + 1}`
        labels.set(id, {
          kind: 'chat',
          conversation,
          others: conversation.others,
        })
        lines.push(`${id} with ${name(conversation.others[0])}:`)
        conversation.messages.slice(-MESSAGES_SHOWN).forEach((message) => {
          lines.push(
            `  ${
              message.from === me ? 'you' : name(message.from)
            }: "${shownText(message.text, message.hasMedia)}"`
          )
        })
      })
      sections.push(lines.join('\n'))
    }
  }

  const empty = sections.length === 0
  return {
    text: empty ? '' : `Since your last run:\n\n${sections.join('\n\n')}`,
    labels,
    empty,
    readTo: head,
  }
}
