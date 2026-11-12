// The renderer's side of the agent channel (main/agent/agent.js). The key goes in through setKey and never comes
// back: the status says only whether one is kept.

const agent = (command, data) =>
  global.ipcRenderer.invoke('agent', command, data)

// Who shows the agent's state (the menu's card, Settings › Agent) hears each saved change.
const listeners = new Set()

/** Calls `listener(status)` after each settings save; returns the unsubscribe. */
export function onAgentChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const agentStatus = () => agent('status')
export async function saveAgentSettings(settings) {
  const status = await agent('saveSettings', settings)
  listeners.forEach((listener) => listener(status))
  return status
}
export const setAgentKey = (key) => agent('setKey', {key})
export const clearAgentKey = () => agent('clearKey')
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
