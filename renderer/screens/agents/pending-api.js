import * as React from 'react'
import {agentErrorText} from '../settings/agent/api'

// The renderer's side of To approve (main/agent/pending.js): the list of actions the agents prepared with Ask me,
// read again each time the main process says it changed ("agent-event"), and the approval: the main process hands
// the action over, the app's own code does it (an executor below, as the person's click would), the main process
// hears how it went.

const agent = (command, data) =>
  global.ipcRenderer.invoke('agent', command, data)

/**
 * What each kind of action runs once approved: `executors[action](item)` resolves to a line for the Activity, or
 * throws the reason it failed. Filled by the tools of the actions (the joke agent's post, B-237); an action with
 * no executor cannot be approved in this version.
 */
export const executors = {}

export const pendingActions = () => agent('pending')
export const declineAction = (id) => agent('decline', {id})

/**
 * Approves the item, with the person's edit of its text: the main process checks again that the agent may do it,
 * the executor does it, the main process logs how it went. Resolves to the line logged; throws the reason it was
 * refused or failed (a failed action waits again, with its error).
 */
export async function approveAction(item, body, run = executors) {
  const execute = run[item.action]
  if (!execute) throw new Error('this app cannot do this action yet')
  const approved = await agent('approve', {id: item.id, body})
  let detail
  try {
    detail = String((await execute(approved)) || '')
  } catch (error) {
    await agent('finish', {
      id: item.id,
      ok: false,
      detail: agentErrorText(error),
    })
    throw error
  }
  await agent('finish', {id: item.id, ok: true, detail})
  return detail
}

/** The items waiting, kept up to date (null until read). */
export function usePendingActions() {
  const [items, setItems] = React.useState(null)
  React.useEffect(() => {
    // Outside the app (a page's test without the main process): nothing to read.
    if (!global.ipcRenderer) return undefined
    let live = true
    const read = () =>
      pendingActions().then(
        (next) => live && setItems(next),
        () => {}
      )
    read()
    const off = global.ipcRenderer.on('agent-event', (_, event) => {
      if (event === 'pending') read()
    })
    return () => {
      live = false
      off()
    }
  }, [])
  return items
}
