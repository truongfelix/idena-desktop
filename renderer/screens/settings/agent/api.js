// The renderer's side of the agent channel (main/agent/agent.js). The key goes in through setKey and never comes
// back: the status says only whether one is kept.

const agent = (command, data) =>
  global.ipcRenderer.invoke('agent', command, data)

// Who shows the agent's state (the menu's card, Settings › Agent, the validation) hears each change written, and
// the last status read is kept for a part that mounts again (the menu, at each page).
const listeners = new Set()
let lastStatus = null

/** Calls `listener(status)` after each change written (settings, key); returns the unsubscribe. */
export function onAgentChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The last status read or written, or null. */
export const lastAgentStatus = () => lastStatus

export const agentStatus = () =>
  agent('status').then((status) => {
    lastStatus = status
    return status
  })

// One write at a time, whoever writes (a field's blur, a click, the menu card's Pause): each change is applied to
// the settings the main process holds when its turn comes, so two quick changes cannot undo each other.
let writing = Promise.resolve()
function write(call) {
  const done = writing.then(call).then((status) => {
    lastStatus = status
    listeners.forEach((listener) => listener(status))
    return status
  })
  writing = done.catch(() => {})
  return done
}

/** Saves `change(settings)`, `change` applied to the saved settings when this write's turn comes. */
export const updateAgentSettings = (change) =>
  write(async () =>
    agent('saveSettings', change((await agent('status')).settings))
  )
export const saveAgentSettings = (settings) =>
  write(() => agent('saveSettings', settings))
export const setAgentKey = (key) => write(() => agent('setKey', {key}))
export const clearAgentKey = () => write(() => agent('clearKey'))
export const agentActivity = () => agent('activity')
export const stopAgentTest = () => agent('stopTest')
export const stopAgentSolve = () => agent('stopSolve')
export const testAgentFlip = (flip, timeoutMs) =>
  agent('testFlip', {flip, timeoutMs})
export const solveAgentFlip = (flip, {reportsUsed, timeoutMs}) =>
  agent('solveFlip', {flip, reportsUsed, timeoutMs})

/** An error from the main process, without Electron's "Error invoking remote method" prefix. */
export function agentErrorText(error) {
  const text = String(error?.message || error || '')
  return text.replace(/^Error invoking remote method '[^']*': (Error: )?/u, '')
}
