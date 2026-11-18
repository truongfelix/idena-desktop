import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {useSocial} from '../social/provider'
import {useIdentityState} from '../../shared/providers/identity-context'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useSettingsState} from '../../shared/providers/settings-context'
import {shownNames} from '../social/profiles'
import {blockedAddresses} from '../social/people'
import {historyDone} from '../social/scan'
import {agentsList, lastAgentsList, onAgentsChange} from '../settings/agent/api'
import {decliners, executors} from './pending-api'
import {heldFlipSteps} from './flips/drafts'
import {runFlipsAgent} from './flips/run'
import {flipsDecliners, flipsDeps, flipsExecutors} from './flips/execute'
import {readAuthors} from './criteria'
import {socialRpc, socialRpcSettled} from '../social/node'
import {
  heldSocial,
  readsMessages,
  runSocialAgent,
  scannedHeight,
} from './social/run'
import {EVENT_MIN_MS, eventPending, eventReadBy} from './social/events'
import {tagsLeftOf} from './social/tags'
import {loadPicture} from './social/pictures'
import {
  prepareSocialAction,
  sendSocialAction,
  socialExecutors,
} from './social/execute'

// The agents' runs in the window (B-243, B-239): every minute, each agent on, not paused, holding a Social action,
// runs when its time comes (every hour, or once a day after its time), when the Social scan is up to date. An agent
// holding only Flips steps (B-258) runs on its schedule without waiting for the scan; one holding Social actions too
// waits for it, so that its run of the day is never taken by a run without its Social part. An approved action (To
// approve) is done with the same code.

const CHECK_MS = 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/** A run that failed (the model or the node did not answer) is tried again after this, a few times a day. */
const RETRY_MS = 15 * 60 * 1000
const MAX_TRIES = 3
// Each agent's runs today, in this window: {day, done, tries, retryAt} (a reload runs it again: its read point and
// the main process's counts of the day hold).
const runs = new Map()
// When an event last ran each agent, in this window, and its event runs that failed today: {day, n}.
const lastEvent = new Map()
const eventFails = new Map()

/**
 * The events that may run the agent: only those it reads (likes, answers, tips: Notifications; messages; the posts
 * that tag it).
 */
export function eventsRead(agent) {
  const {reads = {}, events = []} = agent
  return events.filter((one) => eventReadBy(one, reads))
}

/** Whether an event may still run the agent today: not after MAX_TRIES failed event runs that day. */
export const eventsAllowed = (fails, day) =>
  !fails || fails.day !== day || fails.n < MAX_TRIES

/** The failed event runs of the day after a run that gave `result`. */
export function afterEventRun(fails, day, result) {
  if (result !== 'failed') return fails
  const n = fails && fails.day === day ? fails.n : 0
  return {day, n: n + 1}
}
// The agents running now: one run at a time each, the scheduled run and Run now alike.
const running = new Set()

const agentCall = (command, data) =>
  global.ipcRenderer.invoke('agent', command, data)

/** What a Social run reads of the Social state: the claimed names only (never the person's private names). */
export const socialState = (social) => ({
  feed: social.feed,
  me: social.me,
  head: social.head,
  names: shownNames(social.profiles || {}),
  blocked: blockedAddresses(social.people || {}),
  conversations: social.conversations || [],
  cache: social.cache,
  chatStore: social.chatStore,
  messagesRead: social.readThrough?.(),
})

/** Whether the agent runs on Idena Social: a Social action not Off. */
export const isSocialAgent = (agent) => heldSocial(agent).length > 0

/** Whether the agent runs in the Flips area (B-258): a Flips step not Off. */
export const isFlipsAgent = (agent) => heldFlipSteps(agent).length > 0

// What a Flips run reads of the app (the identity, the epoch, the Protect step's settings): the runner keeps it up to
// date, so that Run now on an agent page has it too.
const flipsState = {identity: null, epoch: null, settings: {}, list: null}

/**
 * Whether an agent on may delete a sent flip (B-277): the judge then judges sent flips too; else nothing would read
 * its verdict, and each judgement is billed.
 */
export const deletesSent = (list) =>
  Boolean(list) &&
  !list.paused &&
  list.agents.some(
    (one) =>
      one.enabled &&
      one.actions.flipDeleteSent &&
      one.actions.flipDeleteSent.level !== 'off'
  )

/**
 * Whether a Flips run can read what it needs: the identity and the epoch, both read from the node. Before, a run
 * would find nothing to do, and an hourly agent would wait an hour (a daily one, its day).
 */
export const flipsReady = (state = flipsState) =>
  Boolean(state.identity && state.identity.address && state.epoch)

/** The outcome of an agent's runs in two areas, one after the other: a failure first, else what they did. */
export function bothRuns(first, second) {
  const outcomes = [first, second].filter(Boolean)
  if (!outcomes.length) return {result: 'off', detail: ''}
  const failed = outcomes.find(({result}) => result === 'failed')
  if (failed) return failed
  const done = outcomes.filter(({result}) => result === 'done')
  if (done.length)
    return {result: 'done', detail: done.map(({detail}) => detail).join(' · ')}
  return outcomes.find(({result}) => result === 'nothing new') || outcomes[0]
}

/**
 * Whether the Social scan holds the account's history up to the chain's head: before, what a run reads (its posts,
 * the tips on them) would be wrong.
 */
export function socialReady(social) {
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

/** Whether the agent's time of the day has come (a daily agent). */
export function dueToday(schedule, now) {
  if (schedule.kind !== 'daily') return false
  return now >= todayAt(schedule, now)
}

/** When a daily agent's time of the day is, on the day of `now` (ms). */
export function todayAt(schedule, now) {
  const [hours, minutes] = schedule.time.split(':').map(Number)
  const at = new Date(now)
  at.setHours(hours, minutes, 0, 0)
  return at.getTime()
}

/**
 * Whether a daily agent still runs today (B-274): its time has come, and no run of it that started since then ended
 * without failing (Run now and event runs included, in this app session or before a restart: the main process keeps
 * the time). A time after now (a clock set wrong once) is not taken as a run.
 */
export function dailyDue(schedule, now, lastRun) {
  const at = todayAt(schedule, now)
  return (
    now >= at &&
    !(typeof lastRun === 'number' && lastRun >= at && lastRun <= now)
  )
}

/** Whether a run that gave `result` counts as the agent's run (B-274): it read, asked or found nothing new. */
export const ranFully = (result) =>
  result === 'done' || result === 'nothing new'

/**
 * One run of an agent now, whatever its schedule: `why` is what started it, named in Activity (B-274): 'now' (the
 * agent page's Run now), 'daily', 'hourly' (its time come), 'event'.
 */
export async function runAgentNow(agent, social, t, why = 'now') {
  if (running.has(agent.id)) return {result: 'running', detail: ''}
  running.add(agent.id)
  try {
    const onSocial = isSocialAgent(agent)
    if (!onSocial && !isFlipsAgent(agent)) return {result: 'off', detail: ''}
    const startedAt = Date.now()
    const outcome = bothRuns(
      onSocial ? await runSocial(agent, social, t, why) : null,
      isFlipsAgent(agent)
        ? await runFlipsAgent(
            agent,
            {
              identity: flipsState.identity,
              epoch: flipsState.epoch,
              judgeSent: deletesSent(flipsState.list),
            },
            flipsDeps({settings: flipsState.settings, t})
          ).catch((error) => ({
            result: 'failed',
            detail: String(error?.message || error),
          }))
        : null
    )
    // Only a daily agent reads it: the time the run started, so a run begun before its time is not its daily run.
    if (agent.schedule?.kind === 'daily' && ranFully(outcome.result))
      await agentCall('setLastRun', {agentId: agent.id, at: startedAt}).catch(
        () => {}
      )
    return outcome
  } finally {
    running.delete(agent.id)
  }
}

/** The Social part of a run (B-239). */
function runSocial(agent, social, t, why) {
  const state = socialState(social)
  return runSocialAgent(agent, state, {
    t,
    why,
    agent: agentCall,
    prepare: (item) => prepareSocialAction(item, state),
    send: (pending) => sendSocialAction(pending),
    // The pictures of the posts it reads (B-293), through the app's own node.
    loadPicture: (media, mediaType) =>
      loadPicture(media, mediaType, {rpc: socialRpc}),
    readAuthors: (addresses, needs) =>
      readAuthors(addresses, needs, {
        settled: socialRpcSettled,
        call: socialRpc,
      }),
  })
}

/** Whether an hourly agent's run is due now: never run in this window, or its next time come. */
export const hourlyDue = (state, now) => !state || now >= state.nextAt

/** An hourly agent's next run after a run that gave `result`: an hour later, a failed one sooner. */
export const afterHourlyRun = (now, result) => ({
  nextAt: now + (result === 'failed' ? RETRY_MS : HOUR_MS),
})

/** Whether the agent's run is due now: not done today, and not waiting for a retry. */
export function runDue(state, day, now) {
  if (!state || state.day !== day) return true
  if (state.done || state.tries >= MAX_TRIES) return false
  return now >= state.retryAt
}

/** The run's state after a run that gave `result` (a failure, thrown or said, is tried again later). */
export function afterRun(state, day, now, result) {
  const tries = state && state.day === day ? state.tries : 0
  return result === 'failed'
    ? {day, done: false, tries: tries + 1, retryAt: now + RETRY_MS}
    : {day, done: true, tries, retryAt: 0}
}

export function AgentRunner() {
  const {t} = useTranslation()
  const social = useSocial()
  const [list, setList] = React.useState(lastAgentsList)
  flipsState.list = list
  const socialRef = React.useRef(social)
  socialRef.current = social
  // What a Flips run reads, as it is now.
  flipsState.identity = useIdentityState()
  flipsState.epoch = useEpochState()
  flipsState.settings = useSettingsState()

  // An approved Social action (To approve) is done with the Social state as it is then; a Flips step with the draft
  // as it is then.
  React.useEffect(() => {
    Object.assign(
      executors,
      socialExecutors(() => socialState(socialRef.current)),
      flipsExecutors(t)
    )
    Object.assign(decliners, flipsDecliners())
  }, [t])
  const busy = React.useRef(false)

  React.useEffect(() => {
    if (!global.ipcRenderer) return undefined
    let live = true
    agentsList().then(
      (next) => live && setList(next),
      () => {}
    )
    const off = onAgentsChange((next) => live && setList(next))
    return () => {
      live = false
      off()
    }
  }, [])

  React.useEffect(() => {
    if (!list) return undefined
    const check = async () => {
      if (busy.current || list.paused) return
      const now = Date.now()
      const day = new Date(now).toDateString()
      // An agent on Social waits for the scan to be up to date (its run would read it), one only in the Flips area
      // does not (B-258).
      const socialOk = socialReady(socialRef.current)
      const flipsOk = flipsReady()
      const active = list.agents.filter(
        (agent) =>
          agent.enabled &&
          (!isSocialAgent(agent) || socialOk) &&
          (!isFlipsAgent(agent) || flipsOk) &&
          (isSocialAgent(agent) || isFlipsAgent(agent))
      )
      busy.current = true
      try {
        const due = []
        // eslint-disable-next-line no-restricted-syntax
        for (const agent of active) {
          const inWindow = runs.get(agent.id)
          if (agent.schedule.kind === 'hourly') {
            if (hourlyDue(inWindow, now)) due.push(agent)
          } else if (
            runDue(inWindow, day, now) &&
            dueToday(agent.schedule, now)
          ) {
            // Its last run, kept across restarts: unknown, it is not run (a question is billed).
            // eslint-disable-next-line no-await-in-loop
            const last = await agentCall('lastRun', {
              agentId: agent.id,
            }).catch(() => undefined)
            if (last !== undefined && dailyDue(agent.schedule, now, last))
              due.push(agent)
            // Ran today already (before a restart, Run now): done for the day in this window too.
            else if (last !== undefined)
              runs.set(agent.id, afterRun(inWindow, day, now, 'done'))
          }
        }
        // An event (a like, an answer, a tip, a message to it) after its read point runs it too, at most every
        // EVENT_MIN_MS.
        const state = socialState(socialRef.current)
        // eslint-disable-next-line no-restricted-syntax
        for (const agent of active) {
          let events = eventsRead(agent)
          if (
            !socialOk ||
            due.includes(agent) ||
            !events.length ||
            !eventsAllowed(eventFails.get(agent.id), day) ||
            now - (lastEvent.get(agent.id) || 0) < EVENT_MIN_MS
          )
            // eslint-disable-next-line no-continue
            continue
          // A tag starts a run only while it has questions left today (B-264): past them, a run would read none.
          if (events.includes('tag')) {
            // eslint-disable-next-line no-await-in-loop
            const today = await agentCall('tagsToday', {
              agentId: agent.id,
            }).catch(() => null)
            if (tagsLeftOf(agent.reads.tags.perDay, today) === 0)
              events = events.filter((one) => one !== 'tag')
            // eslint-disable-next-line no-continue
            if (!events.length) continue
          }
          // eslint-disable-next-line no-await-in-loop
          const point = await agentCall('readPoint', {agentId: agent.id}).catch(
            () => null
          )
          // Up to where its run reads (its messages: as far as they were decrypted), not further.
          const scanned = scannedHeight(state, readsMessages(agent))
          if (eventPending(events, state, {point, scanned})) {
            lastEvent.set(agent.id, now)
            due.push(agent)
          }
        }
        // eslint-disable-next-line no-restricted-syntax
        for (const agent of due) {
          let why = agent.schedule.kind === 'hourly' ? 'hourly' : 'daily'
          if (lastEvent.get(agent.id) === now) why = 'event'
          // eslint-disable-next-line no-await-in-loop
          const {result} = await runAgentNow(
            agent,
            socialRef.current,
            t,
            why
          ).catch((error) => {
            global.logger?.error('agent run failed', error?.message)
            return {result: 'failed'}
          })
          if (lastEvent.get(agent.id) === now)
            eventFails.set(
              agent.id,
              afterEventRun(eventFails.get(agent.id), day, result)
            )
          else if (result !== 'running')
            runs.set(
              agent.id,
              agent.schedule.kind === 'hourly'
                ? afterHourlyRun(Date.now(), result)
                : afterRun(runs.get(agent.id), day, Date.now(), result)
            )
        }
      } finally {
        busy.current = false
      }
    }
    check()
    const timer = setInterval(check, CHECK_MS)
    return () => clearInterval(timer)
  }, [list, t])

  return null
}
