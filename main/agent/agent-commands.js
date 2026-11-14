const {
  MAX_AGENTS,
  SINGLE_HOLDER_ACTIONS,
  agentSettings,
  normalizeAgent,
} = require('./profiles')

// The Agents section's commands (B-243), beside the validation's (agent.js): the list of agents, one agent saved
// or removed, the pause of them all, each service's key. Every agent is read and written whole through the file of
// agents (profiles.js), which checks each field; the keys stay in the keychain (key.js) and never come back.

const destination = ({provider, address}) => ({provider, address})

/**
 * The commands over `profiles` and `key`. `log(entry)` adds a line to the Activity, `onChange(file)` runs after
 * each write (the validation's question in flight stops when its agent was turned off or paused).
 */
function createAgentCommands({profiles, key, log, onChange = () => {}}) {
  const find = (file, id) => file.agents.find((agent) => agent.id === id)

  const list = () => {
    const file = profiles.read()
    return {
      paused: file.paused,
      keychain: key.keychain(),
      agents: file.agents.map((agent) => ({
        ...agent,
        hasKey: key.has(destination(agent)),
      })),
    }
  }

  const write = (file) => {
    const saved = profiles.write(file)
    onChange(saved)
    return list()
  }

  /** The agent named by `data.agentId`, or an error: a command for an agent removed meanwhile does nothing. */
  const agentOf = (data) => {
    const file = profiles.read()
    const agent = find(file, data && data.agentId)
    if (!agent) throw new Error('no such agent')
    return {file, agent}
  }

  return {
    /** The person's view of the agents: each one with whether its service's key is kept, never the key. */
    agents: list,
    /** The settings of one agent as the permission check reads them (permissions.js), for its own requests. */
    config(agentId) {
      const {file, agent} = agentOf({agentId})
      return {...agentSettings(file, agent), instructions: agent.instructions}
    },
    commands: {
      agents: list,
      /**
       * One agent saved whole: an unknown or missing id is a new agent (at most MAX_AGENTS). An action only one
       * agent may hold (answering the validation) is refused while another agent holds it.
       */
      saveAgent(data) {
        const file = profiles.read()
        const isNew = !data || data.id === undefined || data.id === null
        const current = isNew ? null : find(file, data.id)
        // An agent removed meanwhile (another window, a page left open) is not added back by a late save.
        if (!isNew && !current) throw new Error('no such agent')
        if (isNew && file.agents.length >= MAX_AGENTS)
          throw new Error(`at most ${MAX_AGENTS} agents`)
        const agent = normalizeAgent(
          current ? {...data, id: current.id} : {...data, id: undefined}
        )
        SINGLE_HOLDER_ACTIONS.forEach((name) => {
          const holder = agent.actions[name]
            ? file.agents.find(
                (other) => other.id !== agent.id && other.actions[name]
              )
            : null
          if (holder)
            throw new Error(`${holder.name} already answers the validation`)
        })
        const agents = current
          ? file.agents.map((other) => (other.id === agent.id ? agent : other))
          : [...file.agents, agent]
        log({
          agentId: agent.id,
          action: 'settings',
          decision: current ? 'saved' : 'added',
          detail: agent.name,
        })
        return {...write({...file, agents}), savedId: agent.id}
      },
      removeAgent(data) {
        const {file, agent} = agentOf(data)
        log({
          agentId: agent.id,
          action: 'settings',
          decision: 'removed',
          detail: agent.name,
        })
        return write({
          ...file,
          agents: file.agents.filter((other) => other.id !== agent.id),
        })
      },
      /** Pauses every agent, or resumes them. */
      setPaused(data) {
        const file = profiles.read()
        const paused = Boolean(data && data.paused === true)
        log({
          action: 'settings',
          decision: paused ? 'paused' : 'resumed',
          detail: '',
        })
        return write({...file, paused})
      },
      /** The key of the agent's service (its provider and address), shared by every agent of that service. */
      setAgentKey(data) {
        const {agent} = agentOf(data)
        key.set(data.key, destination(agent))
        log({agentId: agent.id, action: 'key', decision: 'saved', detail: ''})
        return list()
      },
      /** Removes the key of the agent's service: every agent of that service loses it. */
      clearAgentKey(data) {
        const {agent} = agentOf(data)
        key.clear(destination(agent))
        log({agentId: agent.id, action: 'key', decision: 'removed', detail: ''})
        return list()
      },
    },
  }
}

module.exports = {createAgentCommands}
