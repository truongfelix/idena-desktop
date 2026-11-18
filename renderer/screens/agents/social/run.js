import {socialDigest} from './digest'
import {criteriaNeeds, passes} from '../criteria'
import {doneOnFeed, readPlan} from './plan'
import {mostCost} from './execute'
import {tagsLeftOf} from './tags'
import {actionRules} from './rules'
import {shortAddress} from '../../social/people'
import {loadPictures} from './pictures'
import {idKey} from '../../social/feed'

// One run of an agent on Idena Social (B-239, B-240): the app reads what came since its read point (digest.js), the
// model answers with the actions it wants (planSocial in the main process: the app's frame and its Instructions),
// the app keeps only those it may do on what it was shown (plan.js), and asks the main process about each one
// (propose): refused, waiting in To approve (Ask me), or done alone within its daily limit and budget. A tip's
// amount is the person's. Then the read point moves to the block read. Every dependency is passed in (`deps`):
// the agent channel (`agent(command, data)`), the action's preparation and sending (`prepare`, `send`), the words,
// the authors' facts for its criteria (`readAuthors(addresses, needs)`, B-266).

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
export const readsMessages = (agent) => {
  // A rule on its private messages (B-281: once per author, who wrote first) reads the conversations too.
  const message = agent.actions?.message
  const ruled =
    message &&
    message.level !== 'off' &&
    (Boolean(message.perAuthor) || message.onlyAnswers === true)
  return Boolean(
    agent.reads?.messages || agent.events?.includes('message') || ruled
  )
}

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
  // Its questions left today (B-264): the posts that tag it it may still read, a day in UTC, asked before anything
  // else is read. Unknown, the run fails before reading (passed over, they would be lost), as for its read point: a
  // later run reads them.
  let tagsLeft = 0
  if (agent.reads?.tags) {
    const today = await call('tagsToday', {agentId: agent.id})
    if (typeof today !== 'number')
      return {result: 'failed', detail: t('its questions of the day unknown')}
    tagsLeft = tagsLeftOf(agent.reads.tags.perDay, today)
  }
  // Its new posts left today (B-281), asked the same way.
  let postsLeft = Infinity
  if (typeof agent.reads?.posts?.perDay === 'number') {
    const today = await call('postsToday', {agentId: agent.id})
    if (typeof today !== 'number')
      return {result: 'failed', detail: t('its posts of the day unknown')}
    postsLeft = Math.max(0, agent.reads.posts.perDay - today)
  }
  // Whose it reads and whom it acts on (B-266): the authors of what is new read first, when a criterion needs it.
  const who = {
    posts: agent.actions.readPosts?.who || null,
    notifications: agent.actions.readNotifications?.who || null,
    messages: agent.actions.readMessages?.who || null,
    tags: agent.actions.readTags?.who || null,
  }
  const onlyTo = Object.fromEntries(
    held.map((action) => [action, agent.actions[action]?.onlyTo || null])
  )
  const needs = criteriaNeeds([...Object.values(who), ...Object.values(onlyTo)])
  let facts = {}
  if (needs.identity || needs.vouched || needs.trust || needs.named) {
    const authors = new Set()
    socialDigest(
      social,
      {reads: agent.reads, collect: authors},
      {point, scanned}
    )
    // Without a reader, nothing is known of anyone: no criterion that needs it passes.
    facts = deps.readAuthors ? await deps.readAuthors([...authors], needs) : {}
  }
  // What it answered already (B-295): its replies on the feed, and those waiting in To approve; a post read again
  // (its point moved back) is then not answered twice.
  const waitingNow = ((await call('pending')) || []).filter(
    (item) => item.agentId === agent.id
  )
  const {answered} = doneOnFeed(social.feed || [], social.me)
  waitingNow.forEach(({action, target}) => {
    if (action === 'reply' && target && target.postId !== undefined)
      answered.add(idKey(target.postId))
  })
  const options = {
    reads: agent.reads,
    answeredIds: answered,
    who,
    facts,
    tagsLeft,
    postsLeft,
    texts: agent.appParts || null,
  }
  // The pictures of the posts it reads (B-293), when its model is shown them: those the digest would name, loaded
  // first; only those loaded are named (the others keep the placeholder), within MAX_PICTURES.
  let loaded = null
  if (agent.postPictures === 'send' && typeof deps.loadPicture === 'function') {
    const wanted = new Map()
    socialDigest(
      social,
      {...options, pictures: {collect: wanted}},
      {point, scanned}
    )
    loaded = wanted.size
      ? await loadPictures(wanted, deps.loadPicture)
      : new Map()
  }
  const digest = socialDigest(
    social,
    {...options, pictures: loaded ? {have: new Set(loaded.keys())} : null},
    {point, scanned}
  )
  // The posts that tag it past its questions of the day: never read, named in Activity once the point passed them.
  // A line that could not be written stops nothing.
  // The new posts past its posts of the day (B-281): named the same way.
  const tellPostsPassed = () =>
    digest.postsPassed
      ? call('didAction', {
          agentId: agent.id,
          action: 'readPosts',
          skipped: true,
          detail: t('{{count}} past its posts of the day, not read', {
            count: digest.postsPassed,
            nsSeparator: '!!',
          }),
        }).catch((error) =>
          global.logger?.warn('agent activity line not written', error?.message)
        )
      : null
  const tellPassed = () =>
    digest.tagsPassed
      ? call('didAction', {
          agentId: agent.id,
          action: 'readTags',
          skipped: true,
          detail: t('{{count}} past its questions of the day, not read', {
            count: digest.tagsPassed,
            nsSeparator: '!!',
          }),
        }).catch((error) =>
          global.logger?.warn('agent activity line not written', error?.message)
        )
      : null
  // Nothing to read, and no post of its own to write: the model is not asked (its service bills each question).
  if (digest.empty && !held.includes('post')) {
    await call('setReadPoint', {agentId: agent.id, height: digest.readTo})
    await tellPassed()
    await tellPostsPassed()
    return {result: 'nothing new', detail: ''}
  }
  const pictures = loaded
    ? digest.pictures.map(({id, media}) => ({id, ...loaded.get(media)}))
    : []
  const {answer} = await call('planSocial', {
    agentId: agent.id,
    input: digest.text,
    ...(pictures.length ? {pictures} : {}),
    why: deps.why,
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
  // The posts that tag it it was shown count as its questions of the day, first (a failed save of the point must
  // not give them again).
  if (digest.tagsShown)
    await call('countTags', {agentId: agent.id, n: digest.tagsShown})
  if (digest.postsShown && postsLeft !== Infinity)
    await call('countPosts', {agentId: agent.id, n: digest.postsShown})
  await call('setReadPoint', {agentId: agent.id, height: digest.readTo})
  await tellPassed()
  await tellPostsPassed()
  // eslint-disable-next-line no-restricted-syntax
  // eslint-disable-next-line no-await-in-loop
  for (const {action, reason} of plan.dropped.slice(0, DROPPED_LINES))
    await log(SOCIAL_ACTIONS.includes(action) ? action : held[0], {
      skipped: true,
      detail: t('not done: {{reason}}', {reason, nsSeparator: '!!'}),
    })

  const count = {alone: 0, ask: 0, skipped: 0, failed: 0}
  // Once per author, and a message only to who wrote first (B-281).
  // What earlier runs left in To approve counts for its author too.
  const waiting = waitingNow.map(({action, target}) => {
    if (target && Array.isArray(target.others))
      return {action, whom: target.others}
    return {action, whom: target && target.author ? [target.author] : []}
  })
  const noted = (await call('actsDone', {agentId: agent.id})) || []
  const rules = actionRules(agent.actions, social, scanned, waiting, noted)
  const names = social.names || {}
  // eslint-disable-next-line no-restricted-syntax
  for (const planned of plan.actions) {
    const {action} = planned
    // Whom it acts on (B-266): a target outside the action's criteria is refused, whatever the model asked.
    // Every one it acts on: a post's author, or each person of a message. A target it cannot know is refused too:
    // the check never fails open.
    // A message goes to the people the plan picked (plan.js `others`), the other actions to the item's author.
    let whom = []
    if (action === 'message') whom = planned.others || []
    else if (planned.item)
      whom = planned.item.author
        ? [planned.item.author]
        : planned.item.others || []
    if (
      onlyTo[action] &&
      (!whom.length ||
        !whom.every((one) =>
          passes(onlyTo[action], one, {
            ...facts[String(one).toLowerCase()],
            named:
              facts[String(one).toLowerCase()]?.named === true ||
              Boolean(names[one]),
          })
        ))
    ) {
      count.skipped += 1
      // eslint-disable-next-line no-await-in-loop
      await log(action, {
        skipped: true,
        detail: t('not done: outside its criteria', {nsSeparator: '!!'}),
      })
      // eslint-disable-next-line no-continue
      continue
    }
    const refused = whom.length ? rules.allows(action, whom) : null
    if (refused) {
      count.skipped += 1
      // eslint-disable-next-line no-await-in-loop
      await log(action, {
        skipped: true,
        detail:
          refused === 'once per author'
            ? t('not done: once per author', {nsSeparator: '!!'})
            : t('not done: they did not write to it first', {
                nsSeparator: '!!',
              }),
      })
      // eslint-disable-next-line no-continue
      continue
    }
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
    // Asked for in this run, done or waiting: the author's once.
    if (['ask', 'alone'].includes(decision.decision)) rules.did(action, whom)
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
      // Noted for once per author, until the chain shows it; a note that fails stops nothing.
      // eslint-disable-next-line no-await-in-loop
      await call('noteActs', {
        agentId: agent.id,
        action,
        whom,
        height: scanned,
      }).catch(() => {})
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
  const done = t(
    '{{alone}} done alone, {{ask}} in To approve, {{skipped}} not done, {{failed}} failed',
    {...count, nsSeparator: '!!'}
  )
  return {result: 'done', detail: done, count}
}
