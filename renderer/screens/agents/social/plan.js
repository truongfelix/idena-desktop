import {LIKE} from '../../social/contract'
import {idKey} from '../../social/feed'

// An agent's answer on Idena Social read as a list of actions (B-239): only the actions it holds, only on the labels
// the digest gave, each text a post's length. Whatever else the answer holds is dropped, with the reason: the model
// cannot name a post it was not shown, an amount, or an action it does not hold.

/** The most actions one run may take, whatever the answer asks. */
export const MAX_ACTIONS_PER_RUN = 10
/** A text the agent writes: at most this many characters. */
export const MAX_ACTION_TEXT = 1000

/** The answer's JSON object: the answer itself, or the first {...} in it (a model may add words or a code fence). */
function answerObject(answer) {
  const text = String(answer || '').trim()
  const tries = [text]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) tries.push(text.slice(start, end + 1))
  for (const one of tries) {
    try {
      const value = JSON.parse(one)
      if (value && typeof value === 'object') return value
    } catch {
      // the next try
    }
  }
  return null
}

const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/\r\n?/gu, '\n').trim() : ''

/**
 * The plan: {actions: [{action, label, item, text}], dropped: [{action, reason}]}. `digest` is the run's (digest.js), `held`
 * the Social actions not Off, `me` the account (it never likes, tips or messages itself), `done` what it already did
 * on the chain ({liked, answered}: sets of post ids), so that a second run does not do it twice.
 */
export function readPlan(answer, digest, held, me, done = {}) {
  const value = answerObject(answer)
  if (!value || !Array.isArray(value.actions))
    return {
      actions: [],
      dropped: [{action: '', reason: 'the answer is not a list of actions'}],
    }
  const actions = []
  const dropped = []
  const seen = new Set()
  const liked = done.liked || new Set()
  const answered = done.answered || new Set()
  value.actions.forEach((raw) => {
    const row = raw && typeof raw === 'object' ? raw : {}
    const action = String(row.do || '')
    const label = typeof row.to === 'string' ? row.to.trim() : ''
    const text = cleanText(row.text)
    const drop = (why) =>
      dropped.push({
        action,
        reason: `${action || '?'} ${label}: ${why}`.trim(),
      })
    if (!held.includes(action)) return drop('not an action it may do')
    if (actions.length >= MAX_ACTIONS_PER_RUN)
      return drop('too many actions in one run')
    const needsText = ['post', 'reply', 'message'].includes(action)
    if (needsText && !text) return drop('no text')
    if (needsText && text.length > MAX_ACTION_TEXT) return drop('text too long')
    if (needsText && text === LIKE) return drop('a like is not a text')
    if (action === 'post') {
      actions.push({action, label: '', item: null, text})
      return undefined
    }
    const item = digest.labels.get(label)
    if (!item) return drop('not a label the app gave')
    const key = `${action}:${label}`
    if (seen.has(key)) return drop('asked twice')
    if (action === 'message') {
      const others = item.others || [item.author]
      if (others.includes(me)) return drop('its own account')
      const to = `message:${others.join(',')}`
      if (seen.has(to)) return drop('asked twice')
      seen.add(to)
      seen.add(key)
      actions.push({action, label, item, text, others})
      return undefined
    }
    if (item.kind !== 'post') return drop('not a post')
    if (item.author === me) return drop('its own post')
    if (action === 'reply' && !item.target) return drop('cannot be answered')
    if (action === 'reply' && answered.has(idKey(item.node.id)))
      return drop('answered already')
    if (action === 'like' && liked.has(item.node.id))
      return drop('liked already')
    seen.add(key)
    actions.push({action, label, item, text: action === 'reply' ? text : ''})
    return undefined
  })
  return {actions, dropped}
}

/**
 * What the account already did on each post: {liked, answered}, sets of post ids (from the feed); `answered` holds
 * them as idKey reads them. A post answered has a reply of its own under it, or a comment of its own that answers it
 * (B-295: the feed files every comment under its reply, what it answers is its replyTo).
 */
export function doneOnFeed(feed, me) {
  const liked = new Set()
  const answered = new Set()
  const visit = (node) => {
    if (node.likeCalls.some((call) => call.author === me)) liked.add(node.id)
    if (node.replies.some((reply) => reply.call.author === me))
      answered.add(idKey(node.id))
    if (node.call.author === me && node.call.replyTo)
      answered.add(idKey(node.call.replyTo))
    node.replies.forEach(visit)
  }
  feed.forEach(visit)
  return {liked, answered}
}
