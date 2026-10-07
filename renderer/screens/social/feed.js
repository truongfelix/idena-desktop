import {isLike, validTipAmount} from './calls'
import {PostTarget} from './contract'

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

/**
 * What an answer or a like to each post, reply and comment of the feed answers, by id (PostTarget): a post's
 * answers are replies, a reply's and its comments' answers are comments in the reply's channel.
 */
export function postTargets(feed) {
  const targets = new Map()
  for (const post of feed) {
    targets.set(post.id, PostTarget.onPost(post.id))
    for (const reply of post.replies) {
      targets.set(reply.id, PostTarget.onReply(reply.id))
      for (const comment of reply.replies)
        targets.set(comment.id, PostTarget.onComment(reply.id, comment.id))
    }
  }
  return targets
}
