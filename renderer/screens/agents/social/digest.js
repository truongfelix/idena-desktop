import {LIKE, topicOf} from '../../social/contract'
import {idKey, postTargets} from '../../social/feed'
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
/**
 * The thread a tag sits in (B-290, owner 2026-11-17): besides the post it answers, the thread's first post, then the
 * replies before it, the tag's own branch first, at most this many lines, each text cut shorter than a post's.
 */
export const MAX_THREAD = 8
export const MAX_THREAD_TEXT = 200
/** A first run reads about the last day of blocks (20 s each). */
export const FIRST_RUN_BLOCKS = 4320
/**
 * The most pictures a run sends with what it reads (B-293): each one costs input tokens (about 1,000 at 1024 px), and
 * MAX_DIGEST bounds only the text. Past them, a post's picture is only named, as before.
 */
export const MAX_PICTURES = 20

/**
 * Whether a post's media is a picture the model can be shown (B-293): an image type, inline or on IPFS. A moving one
 * goes as its first frame; a vector image (SVG) is not drawn, a video or a sound is no picture.
 */
export function isPicture(call) {
  if (!call || !call.hasMedia || !call.media) return false
  const type = String(call.mediaType || '').toLowerCase()
  return type.startsWith('image/') && !type.startsWith('image/svg')
}

/**
 * A text as the model reads it: on one quote, cut, a text on IPFS or a picture only named. `words`: the agent's own
 * words for those two (B-285), `onIpfs` and `withFile`.
 */
export function shownText(
  message,
  hasMedia = false,
  words = {},
  max = MAX_TEXT
) {
  const value = String(message || '')
  const text = value.startsWith('ipfs://')
    ? words.onIpfs ?? '[a text stored on IPFS, not read]'
    : value.replace(/\s+/gu, ' ').trim()
  const cut = text.length > max ? `${text.slice(0, max)}…` : text
  return hasMedia
    ? `${cut} ${words.withFile ?? '[with a picture or a file]'}`.trim()
    : cut
}

/** Every node of the feed under `node`, with the post it is in and the node it answers. */
function walk(feed) {
  const out = []
  const visit = (node, post, parent) => {
    out.push({node, post, parent})
    node.replies.forEach((child) => visit(child, post, node))
  }
  feed.forEach((post) => visit(post, post, null))
  return out
}

/** Two calls in chain order: their block, then their place in it (as the Social feed sorts). */
const chainOrder = (a, b) =>
  a.height - b.height || (a.index || 0) - (b.index || 0)

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
    pictures = null,
    answeredIds = null,
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
  // The pictures it is shown (B-293), each named img1, img2… in the text: `pictures.collect` (a Map) gathers those
  // it would show, with their type (the run loads them); `pictures.have` (a Set) holds those loaded, the only ones
  // named. Its own posts and the posts a like or a tip is for (its own too) keep the placeholder. A picture shown
  // twice keeps its name.
  const picked = new Map()
  const pictureId = (call) => {
    if (!pictures || !isPicture(call) || call.author === me) return null
    if (picked.has(call.media)) return picked.get(call.media).id
    if (pictures.have && !pictures.have.has(call.media)) return null
    if (picked.size >= MAX_PICTURES) return null
    const id = `img${picked.size + 1}`
    picked.set(call.media, {id, mediaType: call.mediaType})
    return id
  }
  const withPicture = (call, max = MAX_TEXT) => {
    const id = pictureId(call)
    if (!id) return shownText(call.message, call.hasMedia, words, max)
    const text = shownText(call.message, false, words, max)
    const named = line(
      'with a picture',
      {picture: id},
      `[with the picture ${id}]`
    )
    return `${text} ${named}`.trim()
  }
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
  // What it answered already (B-295, `answeredIds`: idKey ids, its replies on the feed and those waiting in To
  // approve; "chat:<address>" a conversation whose answer waits there):
  // never read again as an answer, a tag or a new post, whatever its read point (read again, it would answer twice).
  const isAnswered = (node) =>
    Boolean(answeredIds && answeredIds.has(idKey(node.id)))

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
          !isAnswered(node) &&
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
        !isAnswered({id}) &&
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
          !isAnswered(node) &&
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
        isBlocked(conversation.others[0]) ||
        // Its answer waits in To approve (B-295).
        Boolean(
          answeredIds &&
            answeredIds.has(
              `chat:${String(conversation.others[0]).toLowerCase()}`
            )
        )
      )
        return
      // Only what came after its own last message (B-295): read again, a conversation it answered is not new.
      const lastOwn = conversation.messages.reduce(
        (at, message, i) => (message.from === me ? i : at),
        -1
      )
      const fresh = conversation.messages.filter(
        (message, i) => i > lastOwn && message.from !== me && isNew(message)
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
  // The thread a tag in an answer sits in (B-290): the thread's first post and the replies before the tag, the tag's
  // own branch first (the reply it sits under and its comments), then the other replies, nearest the tag kept; every
  // author whatever their state (Whose picks the tags, not their context). Left out: the blocked authors and what
  // answers them, a post a tag before it in this run already showed, what came after the tag. No label: the agent
  // answers the tag, never these. The feed files every comment under its reply; what each one answers is its replyTo.
  const shownInThread = new Set()
  const threadText = (call) => withPicture(call, MAX_THREAD_TEXT)
  const threadOf = (item) => {
    const tree = walk([item.post])
    const byId = new Map(tree.map(({node}) => [idKey(node.id), node]))
    // What a post answers, as the Social screen's comment tree reads it (feed.js commentTree): its replyTo when that
    // is another post of this thread, else the one it is filed under.
    const answeredBy = ({node, parent}) => {
      const to = byId.get(idKey(node.call.replyTo))
      return to && to !== node ? to : parent
    }
    // The tag's own line quotes what it answers; never a blocked author's text (the one it is filed under then).
    const target = answeredBy(item)
    const answered = isBlocked(target.call.author) ? item.parent : target
    const branch = item.parent === item.post ? item.node : item.parent
    const inBranch = ({node, parent}) => node === branch || parent === branch
    const earlier = tree
      .map((entry) => ({...entry, to: entry.parent && answeredBy(entry)}))
      .filter(
        ({node, to}) =>
          typeof node.id === 'number' &&
          node !== item.node &&
          node !== answered &&
          !shownInThread.has(node.id) &&
          !isBlocked(node.call.author) &&
          !(to && isBlocked(to.call.author)) &&
          chainOrder(node.call, item.node.call) < 0
      )
      .sort((a, b) => chainOrder(a.node.call, b.node.call))
    const first = earlier.find(({node}) => node === item.post)
    const replies = earlier.filter(({node}) => node !== item.post)
    const room = MAX_THREAD - (first ? 1 : 0)
    const ownBranch = room > 0 ? replies.filter(inBranch).slice(-room) : []
    const left = room - ownBranch.length
    const others =
      left > 0 ? replies.filter((one) => !inBranch(one)).slice(-left) : []
    const kept = [...(first ? [first] : []), ...ownBranch, ...others].sort(
      (a, b) => chainOrder(a.node.call, b.node.call)
    )
    // The first post is shown with each thread; the replies once a run.
    ownBranch.concat(others).forEach(({node}) => shownInThread.add(node.id))
    const thread = kept.map(({node, to}) => {
      const author = name(node.call.author)
      const text = threadText(node.call)
      if (node === item.post)
        return line(
          'thread post',
          {author, text},
          `  the thread's first post, by ${author}: "${text}"`
        )
      const answering = name(to.call.author)
      return line(
        'thread reply',
        {author, to: answering, text},
        `  ${author}, answering ${answering}: "${text}"`
      )
    })
    return {answered, thread}
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
    const picturesBefore = new Map(picked)
    const kept = {posts, chats, people}
    let text
    if (item.kind === 'answer') {
      const yours = label(item.parent, item.post)
      const id = label(item.node, item.post)
      const author = name(item.node.call.author)
      const parent = shown(item.parent.call.message, item.parent.call.hasMedia)
      const said = withPicture(item.node.call)
      text = line(
        'answer',
        {label: id, author, yours, parent, text: said},
        `${id} by ${author}, answering your ${yours} ("${parent}"): "${said}"`
      )
    } else if (item.kind === 'tag') {
      const id = label(item.node, item.post)
      const author = name(item.node.call.author)
      const said = withPicture(item.node.call)
      if (item.parent) {
        const {answered, thread} = threadOf(item)
        const to = name(answered.call.author)
        const parent = withPicture(answered.call)
        text = [
          line(
            'tag in an answer',
            {label: id, author, to, parent, text: said},
            `${id} by ${author}, answering ${to} ("${parent}"): "${said}"`
          ),
          ...thread,
        ].join('\n')
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
      const said = withPicture(item.node.call)
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
      // Nor its pictures.
      picked.clear()
      picturesBefore.forEach((value, key) => picked.set(key, value))
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
  if (pictures && pictures.collect)
    picked.forEach(({mediaType}, media) =>
      pictures.collect.set(media, mediaType)
    )
  const ownText = own.length
    ? `Your last posts, the newest last:\n${own.join('\n')}\n\n`
    : ''
  const nothing = line('nothing new', {}, 'Nothing new since your last run.')
  const since = line('new', {}, 'Since your last run:')
  // A kind the agent's layout has no slot for goes at its end: what a run counts as read is always shown.
  const digest =
    texts && texts.socialDigest
      ? fillSlots(
          texts.socialDigest,
          {
            ownPosts: own.join('\n'),
            sinceLastRun: empty ? nothing : since,
            tips: lines.tip.join('\n'),
            likes: lines.like.join('\n'),
            answers: lines.answer.join('\n'),
            tags: lines.tag.join('\n'),
            posts: lines.post.join('\n'),
            messages: lines.chat.join('\n'),
          },
          {
            required: [
              'ownPosts',
              'tips',
              'likes',
              'answers',
              'tags',
              'posts',
              'messages',
            ],
          }
        )
      : `${ownText}${empty ? nothing : `${since}\n\n${sections.join('\n\n')}`}`
  return {
    text: digest,
    labels,
    empty,
    readTo: readUpTo(leftOut, lastHeight, from, scanned),
    // The pictures named in the text, in their order: [{id, media}] (the run sends those it loaded).
    pictures: [...picked.entries()].map(([media, {id}]) => ({id, media})),
    postsPassed,
    tagsShown: counts.tag,
    postsShown: counts.post,
    tagsPassed,
  }
}
