import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {useSocial} from '../../social/provider'
import {shownNames} from '../../social/profiles'
import {
  agentsList,
  lastAgentsList,
  onAgentsChange,
} from '../../settings/agent/api'
import {executors} from '../pending-api'
import {dueToday, runJokeAgent, socialReadyForJokes} from './run'
import {postCost, postOnSocial} from './social-post'

// The agents' runs in the window (B-243, B-237): every minute, each joke agent on, not paused, whose time of the day
// has come, runs once that day, when the Social scan is up to date. An approved post (To approve) is posted with
// the same code.

executors.post = (item) => postOnSocial(item.body)

const CHECK_MS = 60 * 1000
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

/** One run of a joke agent now, whatever its schedule (the agent page's Run now, or its time come). */
export async function runAgentNow(agent, social, t) {
  if (running.has(agent.id)) return {result: 'running', detail: ''}
  running.add(agent.id)
  try {
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
      const due = list.agents.filter(
        (agent) =>
          agent.enabled &&
          agent.task === 'joke' &&
          agent.actions.post &&
          runDue(runs.get(agent.id), day, now) &&
          dueToday(agent.schedule, now)
      )
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
              afterRun(runs.get(agent.id), day, Date.now(), result)
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
