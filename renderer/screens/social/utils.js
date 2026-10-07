// idena.social (https://idena.social), read from the node: posts are makePost calls of its contract, whose JSON
// argument holds the text, and tips are sendTip calls. The rules follow idena.social-ui (getNewPosterAndPost in
// src/logic/asyncUtils.ts, PostComponent.tsx) and the phone app (Social.kt), for posts made since the current
// contract (v12).

/** The idena.social contract (idena.social-ui v12) and the block where its posts start. */
export const SOCIAL_CONTRACT = '0x840e092e31e9656fF15E541505039ed77585338E'
export const SOCIAL_FIRST_BLOCK = 10929805

/** A reply made of this text only is a like of the post it replies to. */
export const LIKE = '❤️'

/** Inline media larger than this (base64 characters, about 1 MB) is not kept in the scan. */
export const MAX_INLINE_MEDIA = 1400000

const textDecoder = new TextDecoder()

function hexToText(hex) {
  const clean = String(hex || '').replace(/^0x/, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return textDecoder.decode(bytes)
}

function parseObject(hex) {
  try {
    const value = JSON.parse(hexToText(hex))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

const text = (value) => (typeof value === 'string' ? value : '')

/**
 * The post of a makePost call (bcn_contractCalls): its first argument is the JSON idena.social sends (message,
 * replyToPostId, channelId, media, mediaType). Null when it is not such JSON.
 */
export function parsePost({hash, height, timestamp, index, from, args}) {
  const arg = parseObject(args?.[0])
  if (!arg) return null
  const {media, mediaType} = arg
  const hasMedia =
    Array.isArray(media) &&
    media.length > 0 &&
    Array.isArray(mediaType) &&
    mediaType.length > 0
  const first = hasMedia ? text(media[0]) : ''
  return {
    hash,
    height,
    time: timestamp,
    index,
    author: String(from).toLowerCase(),
    message: text(arg.message),
    replyTo: text(arg.replyToPostId),
    channel: text(arg.channelId),
    hasMedia,
    media:
      first.startsWith('ipfs://') || first.length <= MAX_INLINE_MEDIA
        ? first
        : '',
    mediaType: hasMedia ? text(mediaType[0]) : '',
  }
}

/** The tip of a sendTip call: its argument is {"postId", "tipAmount"}; the call sends `amount` iDNA. */
export function parseTip({hash, height, timestamp, index, from, amount, args}) {
  const arg = parseObject(args?.[0])
  if (!arg) return null
  return {
    hash,
    height,
    time: timestamp,
    index,
    from: String(from).toLowerCase(),
    postId: text(arg.postId),
    tipAmount: text(arg.tipAmount),
    amount: String(amount ?? ''),
  }
}

/** The posts and tips among contract calls (bcn_contractCalls). */
export function callsToActivity(calls) {
  const posts = []
  const tips = []
  for (const call of calls) {
    if (call.method === 'makePost') {
      const post = parsePost(call)
      if (post) posts.push(post)
    } else if (call.method === 'sendTip') {
      const tip = parseTip(call)
      if (tip) tips.push(tip)
    }
  }
  return {posts, tips}
}

export const isLike = ({message, replyTo}) => message === LIKE && replyTo !== ''

const CID = /^[A-Za-z0-9]{10,128}$/

/** The IPFS content id of an "ipfs://<cid>" reference, or null when it is not one of plain letters and digits. */
export function ipfsCid(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('ipfs://')) return null
  const cid = ref.slice('ipfs://'.length)
  return CID.test(cid) ? cid : null
}

const WHOLE_IDNA = /^[0-9]{1,15}$/

/** Whether the whole number `a` is at least `b` (both plain digit strings, any length). */
function atLeast(a, b) {
  const x = a.replace(/^0+(?=.)/, '')
  const y = b.replace(/^0+(?=.)/, '')
  return x.length !== y.length ? x.length > y.length : x >= y
}

/**
 * The tip in iDNA when the contract accepts it (sendTip): a whole number of at least 1 and no more than was
 * sent; null otherwise (such a call fails).
 */
export function validTipAmount({tipAmount, amount}) {
  if (!WHOLE_IDNA.test(tipAmount) || Number(tipAmount) <= 0) return null
  const sent = /^([0-9]+)(?:\.[0-9]+)?$/.exec(String(amount))
  // The sent amount covers a whole tip exactly when its whole part does.
  return sent && atLeast(sent[1], tipAmount) ? Number(tipAmount) : null
}

const byChainOrder = (a, b) => a.height - b.height || a.index - b.index

/**
 * The ids of the posts: the contract numbers the successful makePost calls 1, 2, 3... and keeps each id's author
 * (`authors`, contract map "p:"). Going from the newest call to the oldest, a call gets the next id down when its
 * sender is that id's author; a call that does not match failed and has no id. `posts` and `authors` must cover
 * the same blocks.
 */
export function postIds(posts, authors) {
  const ids = new Map()
  let id = Math.max(0, ...Object.keys(authors).map(Number))
  const newestFirst = [...posts].sort(byChainOrder).reverse()
  for (const post of newestFirst) {
    if (id < 1) break
    if (authors[id] === post.author) {
      ids.set(post.hash, id)
      id -= 1
    }
  }
  return ids
}

const POST = 0
const REPLY = 1
const COMMENT = 2
const LIKE_LEVEL = 3

/**
 * The feed, newest first, as idena.social shows it (PostComponent.tsx): posts in the main channel; under each
 * post its replies; under each reply its comments, in the channel "discuss:<reply id>" (a main-channel answer to
 * a reply or a comment counts as a comment too). A like (a reply made of LIKE) only counts on what it replies to.
 * Each post needs a text or media, an id, and a known, older parent that is not a like; posts in other channels
 * are left out. A tip counts on the post it names when its amount is valid and it comes after that post.
 * Each node: {id, call, likeCalls, tips, replies}.
 */
export function socialFeed(posts, authors, tips = []) {
  const ids = postIds(posts, authors)
  const byId = new Map()
  for (const post of posts) {
    const id = ids.get(post.hash)
    if (id !== undefined) byId.set(id, post)
  }
  const answers = new Map()
  const likes = new Map()
  const topLevel = []
  const levels = new Map()
  const replyOf = new Map()
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
  }
  const toId = (value) => (/^[0-9]+$/.test(value) ? Number(value) : null)

  // A post always has a greater id than the post it answers: in id order, parents come first.
  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    const post = byId.get(id)
    // eslint-disable-next-line no-continue
    if (post.message === '' && !post.hasMedia) continue
    let discussId = null
    if (post.channel !== '') {
      // eslint-disable-next-line no-continue
      if (!post.channel.startsWith('discuss:')) continue
      discussId = toId(post.channel.slice('discuss:'.length))
      // eslint-disable-next-line no-continue
      if (discussId === null) continue
    }
    const parentId = toId(post.replyTo)
    // eslint-disable-next-line no-continue
    if (post.replyTo !== '' && parentId === null) continue
    if (parentId === null && discussId === null) {
      levels.set(id, POST)
      topLevel.push(id)
      // eslint-disable-next-line no-continue
      continue
    }
    // What it answers: the post, reply or comment it replies to, else the reply of its channel.
    const targetId = parentId ?? discussId
    const targetLevel = levels.get(targetId)
    // eslint-disable-next-line no-continue
    if (targetLevel === undefined) continue
    const target = byId.get(targetId)
    // eslint-disable-next-line no-continue
    if (post.time <= target.time || isLike(target)) continue
    if (isLike(post)) {
      push(likes, targetId, post)
      levels.set(id, LIKE_LEVEL)
      // eslint-disable-next-line no-continue
      continue
    }
    // Where it is shown: a reply under its post, a comment under its reply.
    let reply
    if (discussId !== null) {
      // eslint-disable-next-line no-continue
      if (levels.get(discussId) !== REPLY) continue
      reply = discussId
    } else if (targetLevel === POST) reply = null
    else if (targetLevel === REPLY) reply = targetId
    else if (targetLevel === COMMENT) reply = replyOf.get(targetId)
    // eslint-disable-next-line no-continue
    else continue
    if (reply === null) {
      levels.set(id, REPLY)
      push(answers, targetId, id)
    } else {
      // eslint-disable-next-line no-continue
      if (post.time <= byId.get(reply).time) continue
      levels.set(id, COMMENT)
      replyOf.set(id, reply)
      push(answers, reply, id)
    }
  }

  const tipsOf = new Map()
  for (const tip of tips) {
    const postId = toId(tip.postId)
    const level = postId === null ? undefined : levels.get(postId)
    // eslint-disable-next-line no-continue
    if (level === undefined) continue
    const post = byId.get(postId)
    const after =
      tip.height > post.height ||
      (tip.height === post.height && tip.index > post.index)
    if (level !== LIKE_LEVEL && after && validTipAmount(tip) !== null)
      push(tipsOf, postId, tip)
  }

  const build = (id) => ({
    id,
    call: byId.get(id),
    likeCalls: likes.get(id) || [],
    tips: (tipsOf.get(id) || []).sort(byChainOrder),
    replies: (answers.get(id) || []).map(build),
  })

  return topLevel.reverse().map(build)
}

export const likeCount = (node) => node.likeCalls.length

/** The iDNA tipped to a post's author for it. */
export const tipTotal = (node) =>
  node.tips.reduce((sum, tip) => sum + (validTipAmount(tip) || 0), 0)

/** The number of replies under a post, at every depth. */
export const replyCount = (node) =>
  node.replies.reduce((sum, reply) => sum + 1 + replyCount(reply), 0)

/** The block of the newest thing in a post's thread: the post, a reply, a comment, a like or a tip. */
export function lastActivityHeight(node) {
  return Math.max(
    node.call.height,
    ...node.likeCalls.map(({height}) => height),
    ...node.tips.map(({height}) => height),
    ...node.replies.map(lastActivityHeight)
  )
}

/**
 * How the feed is ordered: by the newest posts or the latest activity, as idena.social offers it; or the posts of
 * a period with the most likes, answers or iDNA tipped.
 */
export const FeedSort = {
  Newest: 'newest',
  Activity: 'activity',
  Likes: 'likes',
  Comments: 'comments',
  Tips: 'tips',
}

export const FeedPeriod = {Epoch: 'epoch', Week: 'week', All: 'all'}

const rankOf = {
  [FeedSort.Likes]: likeCount,
  [FeedSort.Comments]: replyCount,
  [FeedSort.Tips]: tipTotal,
}

/**
 * The feed (newest posts first) in `sort`'s order. A ranked sort keeps the posts of `period` that have at least
 * one of what it counts, most first, newer first on a tie: `now` (Unix seconds) sets the 7 days, `epochStart`
 * (the epoch's first block) the epoch, which is all posts while it is not known.
 */
export function sortFeed(
  feed,
  sort,
  {period = FeedPeriod.All, now = 0, epochStart = null} = {}
) {
  if (sort === FeedSort.Newest) return feed
  if (sort === FeedSort.Activity)
    return feed
      .map((node, order) => ({node, order, last: lastActivityHeight(node)}))
      .sort((a, b) => b.last - a.last || a.order - b.order)
      .map(({node}) => node)
  const rank = rankOf[sort]
  return feed
    .filter(({call}) => {
      if (period === FeedPeriod.Epoch)
        return epochStart === null || call.height >= epochStart
      if (period === FeedPeriod.Week) return call.time >= now - 7 * 24 * 3600
      return true
    })
    .map((node, order) => ({node, order, value: rank(node)}))
    .filter(({value}) => value > 0)
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .map(({node}) => node)
}

/**
 * What an address did on idena.social, newest first: its posts, replies and comments, what it liked, the tips it
 * gave, and its posts with media; the likes and tips it received are counted. Each entry: {node, threadId,
 * parent, like?, tip?}.
 */
export function socialProfile(feed, address) {
  const me = String(address).toLowerCase()
  const lists = {
    posts: [],
    replies: [],
    comments: [],
    likes: [],
    tips: [],
    media: [],
  }
  let likesReceived = 0
  let tipsReceived = 0
  let tipsGiven = 0

  const visit = (node, threadId, parent, list) => {
    const own = node.call.author === me
    if (own) {
      const item = {node, threadId, parent}
      list.push(item)
      if (node.call.hasMedia) lists.media.push(item)
      likesReceived += likeCount(node)
    }
    for (const like of node.likeCalls)
      if (like.author === me) lists.likes.push({node, threadId, parent, like})
    for (const tip of node.tips) {
      const amount = validTipAmount(tip) || 0
      if (own) tipsReceived += amount
      if (tip.from === me) {
        tipsGiven += amount
        lists.tips.push({node, threadId, parent, tip})
      }
    }
  }

  for (const post of feed) {
    visit(post, post.id, null, lists.posts)
    for (const reply of post.replies) {
      visit(reply, post.id, post.call, lists.replies)
      const inReply = new Map(reply.replies.map((node) => [node.id, node]))
      for (const comment of reply.replies) {
        // A comment answers another comment of the reply, or else the reply.
        const answered = inReply.get(Number(comment.call.replyTo))?.call
        visit(comment, post.id, answered || reply.call, lists.comments)
      }
    }
  }

  const shown = (item) => item.like || item.tip || item.node.call
  const newestFirst = (a, b) =>
    shown(b).height - shown(a).height || shown(b).index - shown(a).index
  for (const list of Object.values(lists)) list.sort(newestFirst)
  return {address: me, ...lists, likesReceived, tipsReceived, tipsGiven}
}

/** An identity's state (dna_identity) as idena.social names it: "Not validated" without one. */
export const identityStatus = (state) =>
  !state || state === 'Undefined' ? 'Not validated' : state

/**
 * How long ago `time` was at `now` (Unix seconds), as Reddit shows it: 5s, 10min, 7h, 1d, 5mo, 2y (a month counted
 * as 30 days, a year as 365); "now" for a time in the future (a computer clock behind the block's).
 */
export function timeAgo(time, now) {
  const s = now - time
  if (s < 0) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}mo`
  return `${Math.floor(s / (365 * 86400))}y`
}

/**
 * The continuation token of a contract_iterateMap page, or null after the last page, where the node returns "0x"
 * (an empty token, which would start over from the first page).
 */
export const nextPageToken = (token) =>
  typeof token === 'string' && token !== '' && token !== '0x' ? token : null

/**
 * The authors of the posts from the contract map "p:" (contract_iterateMap with hex keys and values): the key is
 * the post id as a little-endian u128, the value the author's address as text.
 */
export function postAuthors(items) {
  const authors = {}
  for (const {key, value} of items || []) {
    const bytes = String(key).replace(/^0x/, '').slice(0, 16)
    let id = 0
    // Ids stay far below 2^53: the upper bytes are zero.
    for (let i = bytes.length - 2; i >= 0; i -= 2)
      id = id * 256 + parseInt(bytes.substr(i, 2), 16)
    authors[id] = hexToText(value).toLowerCase()
  }
  return authors
}

/** 1: the first desktop scan (from bcn_contractCalls). */
export const CACHE_VERSION = 1

/**
 * What the app has scanned, kept so that no block is scanned twice: the blocks low..high (none while high < low),
 * the posts and tips found there, and the post authors as of block authorsHeight.
 */
export const emptyCache = (head) => ({
  contract: SOCIAL_CONTRACT,
  version: CACHE_VERSION,
  low: head + 1,
  high: head,
  posts: [],
  tips: [],
  authors: {},
  authorsHeight: 0,
})

/** The cache as saved, or null when it is for another contract or version. */
export function readCache(saved) {
  if (
    !saved ||
    String(saved.contract).toLowerCase() !== SOCIAL_CONTRACT.toLowerCase() ||
    saved.version !== CACHE_VERSION
  )
    return null
  return saved
}

/** Whether the scan reached the contract's first block. */
export const historyDone = (cache) => cache.low <= SOCIAL_FIRST_BLOCK

/** The share of the contract's blocks scanned, 0 to 1. */
export function scannedShare({low, high}) {
  if (high < SOCIAL_FIRST_BLOCK) return 0
  return (
    Math.max(0, high - Math.max(low, SOCIAL_FIRST_BLOCK) + 1) /
    (high - SOCIAL_FIRST_BLOCK + 1)
  )
}

/** The feed of the posts and tips the author map covers. */
export const cacheFeed = ({posts, tips, authors, authorsHeight}) =>
  socialFeed(
    posts.filter(({height}) => height <= authorsHeight),
    authors,
    tips.filter(({height}) => height <= authorsHeight)
  )

/**
 * Scans the blocks after the cache up to the node's head, in batches (source.batchSize()) saved as they complete,
 * then reads the post authors at that head. The authors are only taken when the head did not move meanwhile, so
 * that they match the scanned blocks; otherwise it scans the new blocks again, up to 3 times. Without a cache, the
 * scan starts at the head: the older blocks are the history (scanOlderBlocks). It stops before a batch when
 * keepGoing() turns false, keeping the batches done and the previous authors. `source`: {head(), batchSize(),
 * calls(from, to), authors()}.
 */
export async function checkNewBlocks(
  cache,
  source,
  {keepGoing = () => true, save = () => {}} = {}
) {
  let current = cache
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const head = await source.head()
    let next = current || emptyCache(head)
    while (next.high < head) {
      if (!keepGoing()) return next
      const to = Math.min(next.high + source.batchSize(), head)
      // eslint-disable-next-line no-await-in-loop
      const found = await source.calls(next.high + 1, to)
      next = {
        ...next,
        high: to,
        posts: next.posts.concat(found.posts),
        tips: next.tips.concat(found.tips),
      }
      // eslint-disable-next-line no-await-in-loop
      await save(next)
    }
    // eslint-disable-next-line no-await-in-loop
    const authors = await source.authors()
    // eslint-disable-next-line no-await-in-loop
    if ((await source.head()) === head) {
      next = {...next, authors, authorsHeight: head}
      // eslint-disable-next-line no-await-in-loop
      await save(next)
      return next
    }
    current = next
  }
  return current
}

/** Scans one batch of blocks before the cache, down to the contract's first block. */
export async function scanOlderBlocks(cache, source, {save = () => {}} = {}) {
  if (historyDone(cache)) return cache
  const from = Math.max(cache.low - source.batchSize(), SOCIAL_FIRST_BLOCK)
  const older = await source.calls(from, cache.low - 1)
  const next = {
    ...cache,
    low: from,
    posts: older.posts.concat(cache.posts),
    tips: older.tips.concat(cache.tips),
  }
  await save(next)
  return next
}

/** Blocks the scan may lag the node's head and still be up to date: a block comes about every 20 s. */
export const UP_TO_DATE_LAG = 3

/**
 * The scan's state from the node ({peers, syncing, validation}; null when it does not answer), its head and the
 * cache: {health: good | warn | bad | off, kind, behind?, share?}. Bad without the node or its peers; off during
 * a validation; behind while the node syncs, the posts are more than UP_TO_DATE_LAG blocks behind its head, or
 * the history is not read yet.
 */
export function scanState(node, head, cache) {
  if (!node) return {health: 'bad', kind: 'noNode'}
  if (node.peers === 0) return {health: 'bad', kind: 'noPeers'}
  if (node.validation) return {health: 'off', kind: 'validation'}
  if (node.syncing) return {health: 'warn', kind: 'syncing'}
  if (!cache) return {health: 'warn', kind: 'starting'}
  const behind = (head ?? cache.authorsHeight) - cache.authorsHeight
  if (behind > UP_TO_DATE_LAG) return {health: 'warn', kind: 'behind', behind}
  if (!historyDone(cache))
    return {health: 'warn', kind: 'history', share: scannedShare(cache)}
  return {health: 'good', kind: 'upToDate'}
}

/** The color of an identity state, as the phone app shows it (light theme); null for no identity. */
export const IDENTITY_COLORS = {
  Human: '#B8860B',
  Verified: '#1565C0',
  Newbie: '#2E7D32',
  Candidate: '#00838F',
  Invite: '#7B1FA2',
  Suspended: '#E65100',
  Zombie: '#C62828',
  Killed: '#5D4037',
}

export const identityColor = (state) => IDENTITY_COLORS[state] || null

/** "Human · age 12"; the state alone without an identity or at age 0. */
export function identityLabel(state, age) {
  const status = identityStatus(state)
  return age > 0 && status !== 'Not validated'
    ? `${status} · age ${age}`
    : status
}

export const ActivityKind = {
  Like: 'like',
  Reply: 'reply',
  Comment: 'comment',
  Tip: 'tip',
}

/** What can notify, each kind on or off: likes, replies and comments, tips. */
export const NotifyKind = {Likes: 'likes', Comments: 'comments', Tips: 'tips'}

export const notifyKindOf = (kind) =>
  ({
    [ActivityKind.Like]: NotifyKind.Likes,
    [ActivityKind.Reply]: NotifyKind.Comments,
    [ActivityKind.Comment]: NotifyKind.Comments,
    [ActivityKind.Tip]: NotifyKind.Tips,
  }[kind])

/**
 * What others did on the posts of `me`, newest first, as idena.social's Post Activity: likes, replies to a post,
 * comments on a reply or answering a comment, and tips. Each item: {kind, actor, height, index, time, threadId,
 * focusId, what (the post acted on), answer?, amount?}.
 */
export function socialActivity(feed, me) {
  const items = []
  const add = (kind, call, threadId, focusId, what, extra = {}) =>
    items.push({
      kind,
      actor: call.author ?? call.from,
      height: call.height,
      index: call.index,
      time: call.time,
      threadId,
      focusId,
      what,
      ...extra,
    })
  const likesAndTips = (node, threadId) => {
    for (const like of node.likeCalls)
      if (like.author !== me)
        add(ActivityKind.Like, like, threadId, node.id, node.call)
    for (const tip of node.tips)
      if (tip.from !== me)
        add(ActivityKind.Tip, tip, threadId, node.id, node.call, {
          amount: validTipAmount(tip),
        })
  }
  for (const post of feed) {
    if (post.call.author === me) {
      likesAndTips(post, post.id)
      for (const reply of post.replies)
        if (reply.call.author !== me)
          add(ActivityKind.Reply, reply.call, post.id, reply.id, post.call, {
            answer: reply.call,
          })
    }
    for (const reply of post.replies) {
      if (reply.call.author === me) {
        likesAndTips(reply, post.id)
        for (const comment of reply.replies) {
          // Comments on the reply itself; those answering another comment count for that comment.
          const onReply =
            comment.call.replyTo === '' ||
            comment.call.replyTo === String(reply.id)
          if (onReply && comment.call.author !== me)
            add(
              ActivityKind.Comment,
              comment.call,
              post.id,
              comment.id,
              reply.call,
              {
                answer: comment.call,
              }
            )
        }
      }
      for (const mine of reply.replies) {
        // eslint-disable-next-line no-continue
        if (mine.call.author !== me) continue
        likesAndTips(mine, post.id)
        for (const comment of reply.replies)
          if (
            comment.call.replyTo === String(mine.id) &&
            comment.call.author !== me
          )
            add(
              ActivityKind.Comment,
              comment.call,
              post.id,
              comment.id,
              mine.call,
              {
                answer: comment.call,
              }
            )
      }
    }
  }
  return items.sort((a, b) => b.height - a.height || b.index - a.index)
}

/** The items that are news: in a block after seenThrough, of a kind switched on. */
export const newActivity = (items, seenThrough, enabled) =>
  items.filter(
    ({kind, height}) =>
      height > seenThrough && enabled.includes(notifyKindOf(kind))
  )

/** How many of each kind of notice in `news`: {likes, comments, tips}. */
export function countNotices(news) {
  const counts = {
    [NotifyKind.Likes]: 0,
    [NotifyKind.Comments]: 0,
    [NotifyKind.Tips]: 0,
  }
  for (const {kind} of news) counts[notifyKindOf(kind)] += 1
  return counts
}

/**
 * The comments of reply `replyId` as a tree, in their order, as Reddit nests them: a comment answering the reply,
 * or a comment that is not among them (unknown, or not read yet), is at the top; the others under the comment
 * they answer. Each node: {comment, children}.
 */
export function commentTree(replyId, comments) {
  const ids = new Set(comments.map(({id}) => id))
  const parentOf = (comment) => {
    const parent = /^[0-9]+$/.test(comment.call.replyTo)
      ? Number(comment.call.replyTo)
      : null
    return parent !== null &&
      parent !== replyId &&
      parent !== comment.id &&
      ids.has(parent)
      ? parent
      : null
  }
  const byParent = new Map()
  for (const comment of comments) {
    const parent = parentOf(comment)
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(comment)
  }
  // A comment is placed once: no loop even if two comments named each other.
  const placed = new Set()
  const build = (parent) =>
    (byParent.get(parent) || [])
      .filter(({id}) => {
        if (placed.has(id)) return false
        placed.add(id)
        return true
      })
      .map((comment) => ({comment, children: build(comment.id)}))
  const roots = build(null)
  // Comments in a loop (none reachable from the top) still show, at the top.
  const rest = comments
    .filter(({id}) => !placed.has(id))
    .map((comment) => {
      placed.add(comment.id)
      return {comment, children: []}
    })
  return roots.concat(rest)
}

/** Every comment under a tree node, at any depth. */
export const descendants = (node) =>
  node.children.reduce((sum, child) => sum + 1 + descendants(child), 0)

/** Whether `id` is the node or one of its comments, at any depth. */
export const treeContains = (node, id) =>
  node.comment.id === id ||
  node.children.some((child) => treeContains(child, id))
