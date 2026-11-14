import * as React from 'react'
import {
  agentErrorText,
  agentsList,
  lastAgentsList,
  onAgentsChange,
} from '../settings/agent/api'

/**
 * The list of agents (main/agent/agent-commands.js), read at mount and kept up to date with every change written
 * anywhere (the menu card's Pause, the validation, another page). `run(call)` runs a write and returns its
 * result, or null with the error shown.
 */
export function useAgents() {
  const [list, setList] = React.useState(lastAgentsList)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    let live = true
    const show = (next) => live && setList(next)
    agentsList().then(show, (e) => live && setError(agentErrorText(e)))
    const off = onAgentsChange(show)
    return () => {
      live = false
      off()
    }
  }, [])

  const run = React.useCallback(async (call) => {
    try {
      const result = await call()
      setError(null)
      return result
    } catch (e) {
      setError(agentErrorText(e))
      return null
    }
  }, [])

  return {list, error, run}
}
