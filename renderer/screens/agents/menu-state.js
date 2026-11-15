import * as React from 'react'
import {agentsList, lastAgentsList, onAgentsChange} from '../settings/agent/api'

/**
 * The dot beside Agents in the menu (B-255): 'waiting' (orange) while an action waits in To approve (`toApprove`),
 * 'on' (green) while an agent is on and not paused, none otherwise.
 */
export function agentsDot(list, toApprove) {
  if (toApprove > 0) return 'waiting'
  if (list && !list.paused && list.agents.some((agent) => agent.enabled))
    return 'on'
  return null
}

/** The agents' state for the menu, kept up to date. */
export function useAgentsState(toApprove) {
  const [list, setList] = React.useState(lastAgentsList)
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
  return {dot: agentsDot(list, toApprove)}
}
