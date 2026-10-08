import {validTipAmount} from './calls'
import {idKey, likeCount} from './feed'

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
      const inReply = new Map(
        reply.replies.map((node) => [idKey(node.id), node])
      )
      for (const comment of reply.replies) {
        // A comment answers another comment of the reply, or else the reply.
        const answered = inReply.get(idKey(comment.call.replyTo))?.call
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
            idKey(comment.call.replyTo) === idKey(reply.id)
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
            idKey(comment.call.replyTo) === idKey(mine.id) &&
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
 * The notice of several new things on your posts, as the phone app's: how many, then each kind there is with its
 * count, "3 new on your posts: 2 likes, 1 reply" (replies and comments count as replies).
 */
export function noticesTitle(news, t) {
  const counts = countNotices(news)
  const parts = [
    [counts[NotifyKind.Likes], (count) => t('{{count}} likes', {count})],
    [counts[NotifyKind.Comments], (count) => t('{{count}} replies', {count})],
    [counts[NotifyKind.Tips], (count) => t('{{count}} tips', {count})],
  ]
    .filter(([count]) => count > 0)
    .map(([count, text]) => text(count))
  return t('{{count}} new on your posts: {{parts}}', {
    count: news.length,
    parts: parts.join(', '),
    nsSeparator: '|',
  })
}
