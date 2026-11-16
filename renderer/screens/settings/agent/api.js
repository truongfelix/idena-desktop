// The renderer's side of the agent channel (main/agent/agent.js). The key goes in through setKey and never comes
// back: the status says only whether one is kept.

const agent = (command, data) =>
  global.ipcRenderer.invoke('agent', command, data)

// Who shows the agent's state (the menu's card, the Agents pages, the validation) hears each change written, and
// the last status read is kept for a part that mounts again (the menu, at each page). The Agents section's list of
// agents is heard the same way: a change written by either side shows on both.
const listeners = new Set()
let lastStatus = null
const agentsListeners = new Set()
let lastAgents = null

/** Calls `listener(status)` after each change written (settings, key); returns the unsubscribe. */
export function onAgentChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The last status read or written, or null. */
export const lastAgentStatus = () => lastStatus

/** Calls `listener(list)` after each change written; returns the unsubscribe. */
export function onAgentsChange(listener) {
  agentsListeners.add(listener)
  return () => agentsListeners.delete(listener)
}

/** The last list of agents read or written, or null. */
export const lastAgentsList = () => lastAgents

export const agentsList = () =>
  agent('agents').then((list) => {
    lastAgents = list
    return list
  })

export const agentStatus = () =>
  agent('status').then((status) => {
    lastStatus = status
    return status
  })

// One write at a time, whoever writes (a field's blur, a click, the menu card's Pause): each change is applied to
// the settings the main process holds when its turn comes, so two quick changes cannot undo each other.
let writing = Promise.resolve()

// After each write, both views read again and shown: the validation agent's status and the list of agents.
async function publish() {
  const [status, list] = await Promise.all([agent('status'), agent('agents')])
  lastStatus = status
  lastAgents = list
  listeners.forEach((listener) => listener(status))
  agentsListeners.forEach((listener) => listener(list))
  return {status, list}
}

function queue(call) {
  const done = writing.then(call)
  writing = done.catch(() => {})
  return done
}

/** A write of the validation agent's settings or key; resolves to its status. */
const write = (call) =>
  queue(async () => {
    await call()
    return (await publish()).status
  })

/** A write of the Agents section; resolves to the list of agents, with `savedId` for a save. */
const writeAgents = (call) =>
  queue(async () => {
    const {savedId} = await call()
    const {list} = await publish()
    return savedId ? {...list, savedId} : list
  })

/** Saves `change(settings)`, `change` applied to the saved settings when this write's turn comes. */
export const updateAgentSettings = (change) =>
  write(async () =>
    agent('saveSettings', change((await agent('status')).settings))
  )
export const saveAgentSettings = (settings) =>
  write(() => agent('saveSettings', settings))
export const setAgentKey = (key) => write(() => agent('setKey', {key}))
export const clearAgentKey = () => write(() => agent('clearKey'))
/**
 * Saves `change(agent)`, `change` applied to the agent as saved when this write's turn comes; `null` as the id
 * adds a new agent, `change` applied to nothing.
 */
export const updateAgent = (id, change) =>
  writeAgents(async () => {
    if (id === null) return agent('saveAgent', change({}))
    const current = (await agent('agents')).agents.find((a) => a.id === id)
    if (!current) throw new Error('no such agent')
    const {hasKey, ...saved} = current
    return agent('saveAgent', change(saved))
  })
export const removeAgent = (agentId) =>
  writeAgents(() => agent('removeAgent', {agentId}))
export const setAgentsPaused = (paused) =>
  writeAgents(() => agent('setPaused', {paused}))
export const setServiceKey = (agentId, key) =>
  writeAgents(() => agent('setAgentKey', {agentId, key}))
export const clearServiceKey = (agentId) =>
  writeAgents(() => agent('clearAgentKey', {agentId}))
/** The agent as a file ({fileName, text}): never the key. */
// After the saves in flight: an export right after an edit holds the edit.
export const exportAgentFile = (agentId) =>
  queue(() => agent('exportAgent', {agentId}))
/** What an agent file holds, as it would be added: {agent, asked, dropped, hasKey}. */
export const previewAgentFile = (text) => agent('previewAgent', {text})
/** Adds the agent a file holds, off and each action Off; resolves with `savedId`. */
export const importAgentFile = (text) =>
  writeAgents(() => agent('importAgent', {text}))
export const agentActivity = (agentId) =>
  agent('activity', agentId === undefined ? undefined : {agentId})
export const clearAgentActivity = (agentId) => agent('clearActivity', {agentId})
/**
 * A flip's stories by the agent `agentId` (B-236, B-268): `parts` asked ('story', 'prompts'), the person's `idea`,
 * the titles given before (`notThese`): {stories: [{title, story, prompts}]}.
 */
export const writeFlipStory = (agentId, {words, idea, parts, notThese}) =>
  agent('writeStory', {agentId, words, idea, parts, notThese})
/** One picture of a story's prompt by the agent's image model: {mediaType, data} (base64). */
export const drawStoryPicture = (agentId, prompt) =>
  agent('drawStoryPicture', {agentId, prompt})
export const stopAgentTest = () => agent('stopTest')
export const stopAgentSolve = () => agent('stopSolve')
export const testAgentFlip = (flip, timeoutMs, agentId) =>
  agent('testFlip', {flip, timeoutMs, agentId})
export const solveAgentFlip = (
  flip,
  {reportsUsed, timeoutMs, reportOnly = false}
) => agent('solveFlip', {flip, reportsUsed, timeoutMs, reportOnly})

/** An error from the main process, without Electron's "Error invoking remote method" prefix. */
export function agentErrorText(error) {
  const text = String(error?.message || error || '')
  return text.replace(/^Error invoking remote method '[^']*': (Error: )?/u, '')
}
