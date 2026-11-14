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
// The day each agent last ran, in this window (a reload runs it again: the run's own checks hold, a joke posted
// or waiting today stops it).
const ranOn = new Map()

const agentCall = (command, data) =>
  global.ipcRenderer.invoke('agent', command, data)

/** One run of a joke agent now, whatever its schedule (the agent page's Run now, or its time come). */
export function runAgentNow(agent, social, t) {
  return runJokeAgent(
    agent,
    {
      feed: social.feed,
      me: social.me,
      names: shownNames(social.profiles || {}),
    },
    {t, agent: agentCall, prepare: postCost, post: postOnSocial}
  )
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
          ranOn.get(agent.id) !== day &&
          dueToday(agent.schedule, now)
      )
      if (!due.length || !socialReadyForJokes(socialRef.current)) return
      busy.current = true
      try {
        for (const agent of due) {
          ranOn.set(agent.id, day)
          // eslint-disable-next-line no-await-in-loop
          await runAgentNow(agent, socialRef.current, t).catch((error) =>
            global.logger?.error('agent run failed', error?.message)
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
