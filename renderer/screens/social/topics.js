// Topics: a post whose channelId is "r/<name>" is in topic <name>. Anyone writes in any topic, there is no
// moderation and no contract: the name is only the post's channel. Its replies, comments, likes and tips keep
// today's format and follow it. idena.social shows no post in such a channel; our apps show them in the feed with
// their topic, and in the topic's own feed. The same rules as the phone app (SocialTopics.kt).

import {TOPIC_NAME, TOPIC_PREFIX, topicChannel, topicOf} from './contract'
import {lastActivityHeight} from './feed'

export {TOPIC_PREFIX, topicChannel, topicOf}

/** The topic of a feed node: null when it is in none. */
export const postTopic = (node) => topicOf(node.call.channel)

/**
 * The topic name typed in the editor: "Idena", "r/idena" and " idena " are "idena"; null when what is left is not
 * a topic name. Blank means no topic: the caller checks that first.
 */
export function typedTopic(text) {
  let name = String(text ?? '')
    .trim()
    .toLowerCase()
  if (name.startsWith(TOPIC_PREFIX)) name = name.slice(TOPIC_PREFIX.length)
  return TOPIC_NAME.test(name) ? name : null
}

/** The time of the newest thing in a post's thread, as lastActivityHeight. */
function lastActivityTime(node) {
  return Math.max(
    node.call.time,
    ...node.likeCalls.map(({time}) => time),
    ...node.tips.map(({time}) => time),
    ...node.replies.map(lastActivityTime)
  )
}

/**
 * The topics of the feed, the latest activity first: {name, posts, lastHeight, lastTime}; `query` keeps those
 * whose name holds it ("r/" before it is left out).
 */
export function topicList(feed, query = '') {
  let wanted = String(query).trim()
  if (wanted.startsWith(TOPIC_PREFIX))
    wanted = wanted.slice(TOPIC_PREFIX.length)
  wanted = wanted.toLowerCase()
  const byName = new Map()
  for (const node of feed) {
    const name = postTopic(node)
    // eslint-disable-next-line no-continue
    if (name === null || (wanted && !name.includes(wanted))) continue
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(node)
  }
  return [...byName.entries()]
    .map(([name, posts]) => {
      let last = posts[0]
      for (const node of posts)
        if (lastActivityHeight(node) > lastActivityHeight(last)) last = node
      return {
        name,
        posts: posts.length,
        lastHeight: lastActivityHeight(last),
        lastTime: lastActivityTime(last),
      }
    })
    .sort((a, b) => b.lastHeight - a.lastHeight || a.name.localeCompare(b.name))
}

/** The posts of topic `name`, as the feed has them. */
export const topicFeed = (feed, name) =>
  feed.filter((node) => postTopic(node) === name)

/** The topics followed as kept: valid names only, sorted, each once. */
export function cleanTopics(list) {
  const names = new Set()
  for (const value of Array.isArray(list) ? list : []) {
    const name = topicOf(topicChannel(String(value).trim()))
    if (name !== null) names.add(name)
  }
  return [...names].sort()
}
