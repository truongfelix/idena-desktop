import {historyDone} from '../../social/scan'
import {cleanJoke, jokeInput, jokePost, jokeState, thanksLine} from './joke'

// One run of the joke agent (B-237), once a day after its time: the app counts the tips since the last joke and
// skips the day without one; the model writes the joke; the app writes the post around it and asks the main
// process what the agent may do with it (pending.js propose): wait in To approve (Ask me), post alone (within its
// once a day and its budget), or nothing (Off). Every dependency is passed in (`deps`): the agent channel
// (`agent(command, data)`), the post's fee and its sending (`prepare`, `post`), the words (`t`).

/**
 * Whether the Social scan holds the account's history up to the chain's head: before, the tips and the last joke
 * read from it would be wrong.
 */
export function socialReadyForJokes(social) {
  const {ready, cache, head, me} = social || {}
  const height = typeof head === 'number' ? head : head?.height
  return Boolean(
    ready &&
      me &&
      cache &&
      historyDone(cache) &&
      typeof height === 'number' &&
      cache.high >= height - 3
  )
}

/** The local day of `ms`, and whether the agent's time of the day has come. */
export function dueToday(schedule, now) {
  if (schedule.kind !== 'daily') return false
  const [hours, minutes] = schedule.time.split(':').map(Number)
  const at = new Date(now)
  at.setHours(hours, minutes, 0, 0)
  return now >= at.getTime()
}

/**
 * One run for `agent` (a joke agent, its time come). `social`: the feed, the account's address (`me`) and the tippers'
 * claimed names (`names`, address -> "@name"). Returns what happened, for the caller's log: {result, detail}.
 */
export async function runJokeAgent(agent, social, deps) {
  const {t, now = Date.now()} = deps
  const call = deps.agent
  const skip = async (why) => {
    await call('didAction', {
      agentId: agent.id,
      action: 'post',
      skipped: true,
      detail: why,
    })
    return {result: 'skipped', detail: why}
  }

  const state = jokeState(social.feed, social.me, now)
  if (state.postedToday > 0) return {result: 'done today', detail: ''}
  const waiting = (await call('pending')).some(
    (item) => item.agentId === agent.id && item.action === 'post'
  )
  if (waiting) return {result: 'waiting', detail: ''}
  const number = state.lastNumber + 1
  if (state.tippers.length === 0)
    return skip(
      t('no tip since Joke #{{number}}: no joke today', {
        number: state.lastNumber,
        nsSeparator: '!!',
      })
    )

  const joke = cleanJoke(
    await call('writeText', {
      agentId: agent.id,
      action: 'post',
      input: jokeInput(state.recent),
    })
  )
  if (!joke) {
    await call('didAction', {
      agentId: agent.id,
      action: 'post',
      ok: false,
      detail: t('the model gave no joke'),
    })
    return {result: 'failed', detail: 'no joke'}
  }
  const body = jokePost({
    number,
    joke,
    thanks: thanksLine(state.tippers, social.names),
  })
  const cost = await deps.prepare(body)
  const detail =
    state.tippers.length === 1
      ? t('1 tipper since the last joke · fee about {{fee}} iDNA', {
          fee: cost,
        })
      : t('{{count}} tippers since the last joke · fee about {{fee}} iDNA', {
          count: state.tippers.length,
          fee: cost,
        })
  const decision = await call('propose', {
    agentId: agent.id,
    action: 'post',
    body,
    detail,
    editable: true,
    usage: state.postedToday,
    amount: 1,
    cost,
  })
  if (decision.decision !== 'alone')
    return {result: decision.decision, detail: decision.reason}
  try {
    const done = await deps.post(body)
    await call('didAction', {
      agentId: agent.id,
      action: 'post',
      ok: true,
      cost,
      detail: `Joke #${number} · ${done}`,
    })
    return {result: 'posted', detail: done}
  } catch (error) {
    await call('didAction', {
      agentId: agent.id,
      action: 'post',
      ok: false,
      detail: String(error?.message || error),
    })
    return {result: 'failed', detail: String(error?.message || error)}
  }
}
