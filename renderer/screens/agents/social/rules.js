// The rules of an action on others that the app checks beside its criteria (B-281, main/agent/criteria.js): once per
// author a day or a week, and a private message only to who wrote to it first. What the account already did is read
// from the Social state (the chain), in blocks: a day is DAY_BLOCKS, as the first run's (digest.js).

/** A day and a week of blocks (20 s each). */
export const DAY_BLOCKS = 4320
export const PERIOD_BLOCKS = {day: DAY_BLOCKS, week: 7 * DAY_BLOCKS}

/**
 * The last block the account `me` did each action for each author, from the feed and the conversations:
 * {reply, like, tip, message}, each a Map of lowercase address to height.
 */
export function lastActs({feed = [], conversations = [], me}) {
  const acts = {
    reply: new Map(),
    like: new Map(),
    tip: new Map(),
    message: new Map(),
  }
  const note = (action, address, height) => {
    const who = String(address || '').toLowerCase()
    if (!who || typeof height !== 'number') return
    if (!(acts[action].get(who) >= height)) acts[action].set(who, height)
  }
  const visit = (node) => {
    const {author} = node.call
    if (author !== me) {
      node.replies
        .filter((reply) => reply.call.author === me)
        .forEach((reply) => note('reply', author, reply.call.height))
      ;(node.likeCalls || [])
        .filter((like) => like.author === me)
        .forEach((like) => note('like', author, like.height))
      ;(node.tips || [])
        .filter((tip) => tip.from === me)
        .forEach((tip) => note('tip', author, tip.height))
    }
    node.replies.forEach(visit)
  }
  feed.forEach(visit)
  conversations.forEach((conversation) => {
    if (conversation.isGroup || conversation.group) return
    if ((conversation.others || []).length !== 1) return
    ;(conversation.messages || [])
      .filter((message) => message.from === me)
      .forEach((message) =>
        note('message', conversation.others[0], message.height)
      )
  })
  return acts
}

/**
 * The addresses that wrote to the account `me` first, one to one (lowercase): the conversation's earliest message is
 * theirs. One the account opened does not count, whatever was answered since.
 */
export function wroteFirst({conversations = [], me}) {
  const out = new Set()
  conversations.forEach((conversation) => {
    if (conversation.isGroup || conversation.group) return
    const others = conversation.others || []
    if (others.length !== 1) return
    const first = (conversation.messages || []).reduce(
      (found, message) =>
        typeof message.height === 'number' &&
        (!found || message.height < found.height)
          ? message
          : found,
      null
    )
    if (first && first.from === others[0])
      out.add(String(others[0]).toLowerCase())
  })
  out.delete(String(me || '').toLowerCase())
  return out
}

/**
 * The checks of one run: `allows(action, whom)` says why an action on the people `whom` is refused ('once per
 * author', 'did not write first') or null; `did(action, whom)` counts one this run asked for (done alone or waiting
 * in To approve), so a second one for the same author in the run is refused too. `rows`: the agent's actions,
 * `scanned` the last block read, `waiting` what earlier runs left in To approve ([{action, whom}]): each counts as
 * done for its author until the person decides. The chain is read only when a row has a rule.
 */
export function actionRules(rows, social, scanned, waiting = []) {
  let acts = null
  let wrote = null
  const key = (action, one) => `${action}:${String(one).toLowerCase()}`
  const asked = new Set()
  waiting.forEach(({action, whom}) =>
    (whom || []).forEach((one) => asked.add(key(action, one)))
  )
  return {
    allows(action, whom) {
      const row = rows[action] || {}
      if (action === 'message' && row.onlyAnswers === true) {
        wrote = wrote || wroteFirst(social)
        if (!whom.every((one) => wrote.has(String(one).toLowerCase())))
          return 'did not write first'
      }
      const blocks = PERIOD_BLOCKS[row.perAuthor]
      if (!blocks) return null
      acts = acts || lastActs(social)
      const recent = (one) => {
        const last = acts[action]?.get(String(one).toLowerCase())
        return typeof last === 'number' && last > scanned - blocks
      }
      return whom.some((one) => asked.has(key(action, one)) || recent(one))
        ? 'once per author'
        : null
    },
    did(action, whom) {
      whom.forEach((one) => asked.add(key(action, one)))
    },
  }
}
