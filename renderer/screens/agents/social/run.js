import {socialDigest} from './digest'
import {doneOnFeed, readPlan} from './plan'
import {mostCost} from './execute'
import {shortAddress} from '../../social/people'

// One run of an agent on Idena Social (B-239, B-240): the app reads what came since its read point (digest.js), the
// model answers with the actions it wants (planSocial in the main process: the app's frame and its Instructions),
// the app keeps only those it may do on what it was shown (plan.js), and asks the main process about each one
// (propose): refused, waiting in To approve (Ask me), or done alone within its daily limit and budget. A tip's
// amount is the person's. Then the read point moves to the block read. Every dependency is passed in (`deps`):
// the agent channel (`agent(command, data)`), the action's preparation and sending (`prepare`, `send`), the words.

/** The Social actions an agent can hold (main/agent/social.js SOCIAL_ACTIONS). */
export const SOCIAL_ACTIONS = ['post', 'reply', 'like', 'message', 'tip']

/** The most dropped actions named in the Activity after a run. */
const DROPPED_LINES = 5

/** The Social actions the agent holds and that are not Off. */
export const heldSocial = (agent) =>
  SOCIAL_ACTIONS.filter(
    (name) => agent.actions[name] && agent.actions[name].level !== 'off'
  )

/** What one planned action acts on, as To approve keeps it. */
export function targetOf(planned) {
  const {action, item} = planned
  if (action === 'post') return null
  if (action === 'message') return {others: planned.others}
  return action === 'tip'
    ? {postId: item.node.id, author: item.author}
    : {postId: item.node.id, postTarget: item.target, author: item.author}
}

const short = (text, n = 80) =>
  text.length > n ? `${text.slice(0, n)}…` : text

/** The line To approve and Activity show for a planned action. */
export function plannedLine(planned, {names = {}, amount, fee}, t) {
  const who = (address) => names[address] || shortAddress(address)
  const what = {
    post: () => t('a post'),
    reply: () => t('a reply to {{name}}', {name: who(planned.item.author)}),
    like: () =>
      t('a like of a post by {{name}}', {name: who(planned.item.author)}),
    tip: () =>
      t('a tip of {{amount}} iDNA to {{name}}', {
        amount,
        name: who(planned.item.author),
      }),
    message: () =>
      t('a private message to {{name}}', {name: who(planned.others[0])}),
  }[planned.action]()
  const quoted =
    planned.action === 'like' || planned.action === 'tip'
      ? short(planned.item.node.call.message || '')
      : ''
  return [what, quoted && `“${quoted}”`, t('fee about {{fee}} iDNA', {fee})]
    .filter(Boolean)
    .join(' · ')
}

/** Whether the agent reads private messages, or runs on them: its reading then waits for their decryption. */
export const readsMessages = (agent) =>
  Boolean(agent.reads?.messages || agent.events?.includes('message'))

/** The last block the Social scan read: the feed and the messages hold nothing after it (the chain's head at most). */
export function scannedHeight(social, withMessages = false) {
  const head =
    typeof social.head === 'number' ? social.head : social.head?.height
  // The private messages are decrypted after the scan: no further than they were read.
  const read = withMessages ? social.messagesRead : undefined
  const high =
    typeof read === 'number' && typeof social.cache?.high === 'number'
      ? Math.min(read, social.cache.high)
      : social.cache?.high
  if (typeof high !== 'number') return head
  return typeof head === 'number' ? Math.min(high, head) : high
}

/**
 * One run of `agent` over `social` (the feed, `me`, the conversations, the claimed `names`, `blocked`, the chain's
 * `head`, the scan's `cache`). Returns {result, detail}: 'nothing new', 'done' (with how many actions went where), or what refused it.
 */
export async function runSocialAgent(agent, social, deps) {
  const {t} = deps
  const call = deps.agent
  const held = heldSocial(agent)
  if (!held.length) return {result: 'off', detail: t('no Social action on')}
  const scanned = scannedHeight(social, readsMessages(agent))
  if (typeof scanned !== 'number')
    return {result: 'failed', detail: t('Social has not read the chain yet')}
  const point = await call('readPoint', {agentId: agent.id})
  const digest = socialDigest(social, {reads: agent.reads}, {point, scanned})
  // Nothing to read, and no post of its own to write: the model is not asked (its service bills each question).
  if (digest.empty && !held.includes('post')) {
    await call('setReadPoint', {agentId: agent.id, height: digest.readTo})
    return {result: 'nothing new', detail: ''}
  }
  const {answer} = await call('planSocial', {
    agentId: agent.id,
    input: digest.text,
  })
  const plan = readPlan(
    answer,
    digest,
    held,
    social.me,
    doneOnFeed(social.feed || [], social.me)
  )
  const log = (action, fields) =>
    call('didAction', {agentId: agent.id, action, ...fields})
  // Read: the point moves before any action, so a run stopped midway (the app closed, the window reloaded) never
  // shows the same items again, and never tips or messages twice; what it did not do yet is lost instead.
  await call('setReadPoint', {agentId: agent.id, height: digest.readTo})
  // eslint-disable-next-line no-restricted-syntax
  // eslint-disable-next-line no-await-in-loop
  for (const {action, reason} of plan.dropped.slice(0, DROPPED_LINES))
    await log(SOCIAL_ACTIONS.includes(action) ? action : held[0], {
      skipped: true,
      detail: t('not done: {{reason}}', {reason, nsSeparator: '!!'}),
    })

  const count = {alone: 0, ask: 0, skipped: 0, failed: 0}
  // eslint-disable-next-line no-restricted-syntax
  for (const planned of plan.actions) {
    const {action} = planned
    const amount = action === 'tip' ? agent.actions.tip.amount : undefined
    const item = {action, body: planned.text, target: targetOf(planned), amount}
    let pending
    try {
      // eslint-disable-next-line no-await-in-loop
      pending = await deps.prepare(item)
    } catch (error) {
      count.failed += 1
      // eslint-disable-next-line no-await-in-loop
      await log(action, {ok: false, detail: String(error?.message || error)})
      // eslint-disable-next-line no-continue
      continue
    }
    const cost = mostCost(pending)
    const detail = plannedLine(
      planned,
      {names: social.names, amount, fee: cost.toFixed(2)},
      t
    )
    // eslint-disable-next-line no-await-in-loop
    const decision = await call('propose', {
      agentId: agent.id,
      action,
      body: planned.text,
      detail,
      editable: ['post', 'reply', 'message'].includes(action),
      target: item.target,
      amount: 1,
      cost,
      skipOverLimit: true,
    })
    if (decision.decision === 'ask') count.ask += 1
    else if (decision.decision !== 'alone') count.skipped += 1
    // eslint-disable-next-line no-continue
    if (decision.decision !== 'alone') continue
    // A tip's amount changed by the person since it was prepared: not sent, its count given back.
    if (action === 'tip' && decision.amount !== amount) {
      count.failed += 1
      // eslint-disable-next-line no-await-in-loop
      await log(action, {
        ok: false,
        release: true,
        amount: decision.amount,
        cost,
        detail: t('the amount of a tip changed: not sent', {nsSeparator: '!!'}),
      })
      // eslint-disable-next-line no-continue
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const done = await deps.send(pending)
      count.alone += 1
      // eslint-disable-next-line no-await-in-loop
      await log(action, {ok: true, cost, detail: `${detail} · ${done}`})
    } catch (error) {
      count.failed += 1
      // Never sent (refused before): its count and cost are given back; sent, they stay counted.
      // eslint-disable-next-line no-await-in-loop
      await log(action, {
        ok: false,
        release: !error?.sent,
        amount,
        cost,
        detail: String(error?.message || error),
      })
    }
  }
  return {
    result: 'done',
    detail: t(
      '{{alone}} done alone, {{ask}} in To approve, {{skipped}} not done, {{failed}} failed',
      {...count, nsSeparator: '!!'}
    ),
    count,
  }
}
