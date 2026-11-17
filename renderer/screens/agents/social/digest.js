import {LIKE, topicOf} from '../../social/contract'
import {postTargets} from '../../social/feed'
import {shortAddress} from '../../social/people'
import {validTipAmount} from '../../social/calls'
import {passes} from '../criteria'
import {tagName, tags} from './tags'
import {LINE_NAMES, fillSlots, namedLines} from './texts'

// What an agent reads on Idena Social when it runs (B-239): what came after its read point (a block height), and
// only what its actions need. Each item gets a label (p1, c1) that its answer names; the app keeps what each label
// stands for, so the model can act only on what it was shown. Texts are cut, other people's private names are never
// sent (only names claimed in the profiles contract), and a text on IPFS is said, not fetched.

/** The most items of each kind a run reads, and how long one text may be. */
export const MAX_ANSWERS = 20
export const MAX_CONVERSATIONS = 10
export const MAX_TIPS = 30
/** Its own last posts it reads, to go on from them (a numbered series, what it said already). */
export const OWN_POSTS_SHOWN = 10
export const MESSAGES_SHOWN = 5
export const MAX_TEXT = 500
/** A first run reads about the last day of blocks (20 s each). */
export const FIRST_RUN_BLOCKS = 4320

/**
 * A text as the model reads it: on one quote, cut, a text on IPFS or a picture only named. `words`: the agent's own
 * words for those two (B-285), `onIpfs` and `withFile`.
 */
export function shownText(message, hasMedia = false, words = {}) {
  const value = String(message || '')
  const text = value.startsWith('ipfs://')
    ? words.onIpfs ?? '[a text stored on IPFS, not read]'
    : value.replace(/\s+/gu, ' ').trim()
  const cut = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
  return hasMedia
    ? `${cut} ${words.withFile ?? '[with a picture or a file]'}`.trim()
    : cut
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

/** The most posts a run reads with a window of a day (the window "last N" holds N). */
export const MAX_POSTS_DAY = 50
const DAY_S = 24 * 60 * 60

/**
 * The digest of a run: `social` is the Social state (feed, me, conversations, profiles' claimed `names`, blocked
 * addresses `blocked`); `reads` what the agent reads (profiles.js readsOf, from its read actions: the posts' window,
 * its own posts, its notifications, its private messages); `point` its
 * read point (null: a first run), `scanned` the last block the Social scan read (the feed holds nothing after it),
 * `now` in ms. The new items are taken oldest first, within each kind's cap and MAX_DIGEST; the first one left out
 * ends what is read (`readTo` stops before its block), so the next run shows it. Returns {text, labels, empty,
 * readTo}: the model's input, what each label stands for ({kind: 'post', node, post, target, author}, {kind: 'chat',
 * conversation, others} or {kind: 'person', others}), whether there is anything new, and the block it read up to.
 * The posts that tag it (B-264, `reads.tags`): at most `tagsLeft` (its questions left today), oldest first; those
 * past it are passed over for good (`tagsPassed`), never shown to a later run; `tagsShown` counts those it reads.
 * The new posts (B-281): at most `reads.posts.perRun` a run with the window of a day, and `postsLeft` (its posts left
 * today); `postsShown` counts those it reads.
 * `texts`: the agent's own words for what it reads (B-285, main/agent/social.js): `socialDigest` the layout,
 * `socialLines` the line of each item; an agent that changed none reads the app's, written here as before.
 */
export function socialDigest(
  social,
  {
    reads,
    who = {},
    facts = {},
    collect = null,
    tagsLeft = Infinity,
    postsLeft = Infinity,
    texts = null,
  },
  {point, scanned, now = Date.now()}
) {
  const {feed = [], me, names = {}, conversations = [], blocked} = social
  // Its own lines, by name: one it holds is filled with the item's data, the others are the app's (`fallback`).
  const ownLines =
    texts && texts.socialLines ? namedLines(texts.socialLines, LINE_NAMES) : {}
  const line = (kind, values, fallback) =>
    kind in ownLines
      ? fillSlots(ownLines[kind], values, {drop: false})
      : fallback
  const words = {
    onIpfs: ownLines['text on IPFS'],
    withFile: ownLines['with a file'],
  }
  const shown = (message, hasMedia) => shownText(message, hasMedia, words)
  // Whose it reads (B-266): each read's criteria (`who`: posts, notifications, messages) on the authors' `facts`
  // (criteria.js readAuthors). `collect` (a Set): the authors of what is new go in it, nothing is left out (the run
  // reads them first).
  const isBlocked = (address) => Boolean(blocked && blocked.has(address))
  // `topic`: a new post's topic (null for none), for the posts' topics (B-281); a claimed name is a fact too.
  // An author's facts with its claimed name: the one read for the criteria, or a name the Social screen holds.
  const factsOf = (address) => {
    const read = facts[String(address).toLowerCase()] || {}
    return {...read, named: read.named === true || Boolean(names[address])}
  }
  let postsPassed = 0
  const readsFrom = (kind, address, text = null, topic = undefined) => {
    if (collect) {
      collect.add(String(address).toLowerCase())
      return true
    }
    return passes(who[kind] || null, address, factsOf(address), text, topic)
  }
  const from =
    point === null || point === undefined ? scanned - FIRST_RUN_BLOCKS : point
  const isNew = (item) => item.height > from && item.height <= scanned
  const name = (address) => names[address] || shortAddress(address)
  const targets = postTargets(feed)
  const window = reads?.posts?.window || 'off'
  // Its profile name, tagged as "@name" (B-264): without one claimed, nothing tags it.
  const tagged = reads?.tags ? tagName(names[me]) : null
  // A post that tags it is read only as a tag, within the day's questions: never as an answer or a new post besides.
  const isTag = (node) =>
    Boolean(tagged) &&
    node.call.author !== me &&
    tags(node.call.message, tagged)

  // Every new item, each with the block that makes it new.
  const candidates = []
  if (reads?.notifications) {
    const mine = walk(feed).filter(({node}) => node.call.author === me)
    // The answers to its posts, replies and comments.
    walk(feed)
      .filter(
        ({node, parent}) =>
          parent &&
          parent.call.author === me &&
          node.call.author !== me &&
          !isBlocked(node.call.author) &&
          typeof node.id === 'number' &&
          isNew(node.call) &&
          node.call.message !== LIKE &&
          !isTag(node) &&
          readsFrom('notifications', node.call.author, node.call.message)
      )
      .forEach((one) =>
        candidates.push({kind: 'answer', height: one.node.call.height, ...one})
      )
    // The likes and tips to them: who, how much, on what.
    mine.forEach(({node}) => {
      node.likeCalls
        .filter(
          (like) =>
            like.author !== me &&
            !isBlocked(like.author) &&
            isNew(like) &&
            readsFrom('notifications', like.author)
        )
        .forEach((like) =>
          candidates.push({
            kind: 'like',
            height: like.height,
            from: like.author,
            node,
          })
        )
      node.tips
        // A tip the Social screen does not count (no whole iDNA paid) is no tip.
        .filter(
          (tip) =>
            tip.from !== me &&
            !isBlocked(tip.from) &&
            isNew(tip) &&
            validTipAmount(tip) !== null &&
            readsFrom('notifications', tip.from)
        )
        .forEach((tip) =>
          candidates.push({kind: 'tip', height: tip.height, tip, node})
        )
    })
  }
  if (window !== 'off') {
    let fresh = feed.filter(
      ({id, call}) =>
        typeof id === 'number' &&
        call.author !== me &&
        !isBlocked(call.author) &&
        isNew(call) &&
        !isTag({call}) &&
        readsFrom('posts', call.author, call.message, topicOf(call.channel))
    )
    // The feed is newest first: the last day's posts, or the last N.
    fresh =
      window === 'day'
        ? fresh
            .filter(({call}) => call.time >= now / 1000 - DAY_S)
            .slice(
              0,
              Math.min(MAX_POSTS_DAY, reads.posts.perRun || MAX_POSTS_DAY)
            )
        : fresh.slice(0, reads.posts.count)
    // Its posts left today (B-281): the newest stay, the others are passed over for good, as those past the window.
    if (!collect) {
      const left = Math.max(0, postsLeft)
      postsPassed = Math.max(0, fresh.length - left)
      fresh = fresh.slice(0, left)
    }
    fresh.forEach((node) =>
      candidates.push({kind: 'post', height: node.call.height, node})
    )
  }
  // The posts, replies and comments that tag it (B-264): its questions, with the post each one answers.
  if (tagged)
    walk(feed)
      .filter(
        ({node}) =>
          typeof node.id === 'number' &&
          isTag(node) &&
          !isBlocked(node.call.author) &&
          isNew(node.call) &&
          readsFrom('tags', node.call.author, node.call.message)
      )
      .forEach((one) =>
        candidates.push({kind: 'tag', height: one.node.call.height, ...one})
      )
  if (reads?.messages)
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
      if (
        fresh.length &&
        !readsFrom(
          'messages',
          conversation.others[0],
          fresh.map((message) => message.text || '').join('\n')
        )
      )
        return
      if (fresh.length)
        // At its newest message: a cut before it leaves the whole conversation for the next run, never half.
        candidates.push({
          kind: 'chat',
          height: fresh[fresh.length - 1].height,
          conversation,
        })
    })
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
    post: MAX_POSTS_DAY,
    chat: MAX_CONVERSATIONS,
    tip: MAX_TIPS,
    like: MAX_TIPS,
    tag: MAX_ANSWERS,
  }
  const counts = {answer: 0, post: 0, chat: 0, tip: 0, like: 0, tag: 0}
  const lines = {answer: [], post: [], chat: [], tip: [], like: [], tag: []}
  let tagsPassed = 0
  // A person (a tipper, a liker) once: the agent may write to them.
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
  // Its own last posts, whatever the point (no label: nothing to act on); only when it is given that read (B-262).
  const own = reads?.own
    ? feed
        .filter(({call}) => call.author === me && call.height <= scanned)
        .slice(
          0,
          typeof reads.ownCount === 'number' ? reads.ownCount : OWN_POSTS_SHOWN
        )
        .reverse()
        .map(({call}) => {
          const text = shown(call.message, call.hasMedia)
          return line('own post', {text}, `- "${text}"`)
        })
    : []
  let {length} = own.join('\n')
  let leftOut = null
  let lastHeight = null
  // eslint-disable-next-line no-restricted-syntax
  for (const item of candidates) {
    // Past the day's questions: passed over for good, the read goes on (first come, first served).
    if (item.kind === 'tag' && counts.tag >= tagsLeft) {
      tagsPassed += 1
      // eslint-disable-next-line no-continue
      continue
    }
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
      const author = name(item.node.call.author)
      const parent = shown(item.parent.call.message, item.parent.call.hasMedia)
      const said = shown(item.node.call.message, item.node.call.hasMedia)
      text = line(
        'answer',
        {label: id, author, yours, parent, text: said},
        `${id} by ${author}, answering your ${yours} ("${parent}"): "${said}"`
      )
    } else if (item.kind === 'tag') {
      const id = label(item.node, item.post)
      const author = name(item.node.call.author)
      const said = shown(item.node.call.message, item.node.call.hasMedia)
      if (item.parent) {
        const to = name(item.parent.call.author)
        const parent = shown(
          item.parent.call.message,
          item.parent.call.hasMedia
        )
        text = line(
          'tag in an answer',
          {label: id, author, to, parent, text: said},
          `${id} by ${author}, answering ${to} ("${parent}"): "${said}"`
        )
      } else
        text = line(
          'tag',
          {label: id, author, text: said},
          `${id} by ${author}: "${said}"`
        )
    } else if (item.kind === 'post') {
      const id = label(item.node, item.node)
      const likes = item.node.likeCalls.length
      const author = name(item.node.call.author)
      const said = shown(item.node.call.message, item.node.call.hasMedia)
      let kind = 'post'
      if (likes === 1) kind = 'post with one like'
      else if (likes > 1) kind = 'post with likes'
      text = line(
        kind,
        {label: id, author, likes, text: said},
        `${id} by ${author}${
          likes ? ` (${likes} like${likes > 1 ? 's' : ''})` : ''
        }: "${said}"`
      )
    } else if (item.kind === 'like') {
      const id = personLabel(item.from)
      const author = name(item.from)
      const said = shown(item.node.call.message, item.node.call.hasMedia)
      text = line(
        'like',
        {label: id, author, text: said},
        `${id} ${author} liked "${said}"`
      )
    } else if (item.kind === 'tip') {
      const id = personLabel(item.tip.from)
      const amount = validTipAmount(item.tip)
      const author = name(item.tip.from)
      const said = shown(item.node.call.message, item.node.call.hasMedia)
      text = line(
        'tip',
        {label: id, author, amount, text: said},
        `${id} ${author} tipped you ${amount} iDNA for "${said}"`
      )
    } else {
      chats += 1
      const id = `c${chats}`
      const {conversation} = item
      labels.set(id, {kind: 'chat', conversation, others: conversation.others})
      const other = name(conversation.others[0])
      text = [
        line(
          'conversation',
          {label: id, author: other},
          `${id} with ${other}:`
        ),
        ...conversation.messages.slice(-MESSAGES_SHOWN).map((message) => {
          const author =
            message.from === me ? line('you', {}, 'you') : name(message.from)
          const said = shown(message.text, message.hasMedia)
          return line('message', {author, text: said}, `  ${author}: "${said}"`)
        }),
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
    ['Likes to you:', lines.like],
    ['Answers to you:', lines.answer],
    ['Posts that tag you:', lines.tag],
    ['New posts:', lines.post],
    ['Private messages to you:', lines.chat],
  ]
    .filter(([, list]) => list.length)
    .map(([title, list]) => [title, ...list].join('\n'))
  const empty = sections.length === 0
  const ownText = own.length
    ? `Your last posts, the newest last:\n${own.join('\n')}\n\n`
    : ''
  const nothing = line('nothing new', {}, 'Nothing new since your last run.')
  const since = line('new', {}, 'Since your last run:')
  const digest =
    texts && texts.socialDigest
      ? fillSlots(texts.socialDigest, {
          ownPosts: own.join('\n'),
          sinceLastRun: empty ? nothing : since,
          tips: lines.tip.join('\n'),
          likes: lines.like.join('\n'),
          answers: lines.answer.join('\n'),
          tags: lines.tag.join('\n'),
          posts: lines.post.join('\n'),
          messages: lines.chat.join('\n'),
        })
      : `${ownText}${empty ? nothing : `${since}\n\n${sections.join('\n\n')}`}`
  return {
    text: digest,
    labels,
    empty,
    readTo: readUpTo(leftOut, lastHeight, from, scanned),
    postsPassed,
    tagsShown: counts.tag,
    postsShown: counts.post,
    tagsPassed,
  }
}
