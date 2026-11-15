import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {useSocial} from '../../social/provider'
import {shownNames} from '../../social/profiles'
import {blockedAddresses} from '../../social/people'
import {
  agentsList,
  lastAgentsList,
  onAgentsChange,
} from '../../settings/agent/api'
import {executors} from '../pending-api'
import {dueToday, runJokeAgent, socialReadyForJokes} from './run'
import {postCost, postOnSocial} from './social-post'
import {heldSocial, runSocialAgent} from '../social/run'
import {
  prepareSocialAction,
  sendSocialAction,
  socialExecutors,
} from '../social/execute'

// The agents' runs in the window (B-243, B-237): every minute, each joke agent on, not paused, whose time of the day
// has come, runs once that day, when the Social scan is up to date. An approved post (To approve) is posted with
// the same code.

executors.post = (item) => postOnSocial(item.body)

const CHECK_MS = 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/** A run that failed (the model or the node did not answer) is tried again after this, a few times a day. */
const RETRY_MS = 15 * 60 * 1000
const MAX_TRIES = 3
// Each agent's runs today, in this window: {day, done, tries, retryAt} (a reload runs it again: the run's own checks
// hold, a joke posted or waiting today stops it, and the main process counts the day's post).
const runs = new Map()
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

/** Whether the agent runs on Idena Social: no task of its own (the joke), and a Social action not Off. */
export const isSocialAgent = (agent) =>
  agent.task !== 'joke' && heldSocial(agent).length > 0

/** One run of a joke agent now, whatever its schedule (the agent page's Run now, or its time come). */
export async function runAgentNow(agent, social, t) {
  if (running.has(agent.id)) return {result: 'running', detail: ''}
  running.add(agent.id)
  try {
    if (isSocialAgent(agent)) {
      const state = socialState(social)
      return await runSocialAgent(agent, state, {
        t,
        agent: agentCall,
        prepare: (item) => prepareSocialAction(item, state),
        send: (pending) => sendSocialAction(pending),
      })
    }
    return await runJokeAgent(
      agent,
      {
        feed: social.feed,
        me: social.me,
        names: shownNames(social.profiles || {}),
      },
      {t, agent: agentCall, prepare: postCost, post: postOnSocial}
    )
  } finally {
    running.delete(agent.id)
  }
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
  const socialRef = React.useRef(social)
  socialRef.current = social

  // An approved Social action (To approve) is done with the Social state as it is then.
  React.useEffect(() => {
    Object.assign(
      executors,
      socialExecutors(() => socialState(socialRef.current))
    )
  }, [])
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
      const due = list.agents.filter((agent) => {
        if (!agent.enabled) return false
        const state = runs.get(agent.id)
        if (isSocialAgent(agent) && agent.schedule.kind === 'hourly')
          return hourlyDue(state, now)
        const runsDaily =
          (agent.task === 'joke' && agent.actions.post) || isSocialAgent(agent)
        return (
          runsDaily && runDue(state, day, now) && dueToday(agent.schedule, now)
        )
      })
      if (!due.length || !socialReadyForJokes(socialRef.current)) return
      busy.current = true
      try {
        for (const agent of due) {
          // eslint-disable-next-line no-await-in-loop
          const {result} = await runAgentNow(agent, socialRef.current, t).catch(
            (error) => {
              global.logger?.error('agent run failed', error?.message)
              return {result: 'failed'}
            }
          )
          if (result !== 'running')
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
