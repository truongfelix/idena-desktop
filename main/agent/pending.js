const crypto = require('crypto')
const {ACTIONS} = require('./settings')
const {checkAction} = require('./permissions')
const {agentSettings} = require('./profiles')

// "To approve" (B-243): the actions the agents prepared with Ask me, across the agents, each waiting for the
// person's click. The main process keeps the list and decides; the renderer shows it, and runs an approved action
// with the app's own code (as the person's click would), then says how it went. Kept until the app closes.

const MAX_PENDING = 50
const MAX_TEXT_LENGTH = 10000
const MAX_DETAIL_LENGTH = 500

const newPendingId = () => crypto.randomBytes(8).toString('hex')

const text = (value, max) =>
  typeof value === 'string' ? value.slice(0, max) : ''

/**
 * The list over `profiles` (the file of agents). `log(entry)` adds an Activity line, `notify()` tells the window
 * the list changed.
 */
function createPending({
  profiles,
  log,
  notify = () => {},
  now = Date.now,
  newId = newPendingId,
}) {
  let items = []

  const changed = () => {
    notify()
    return items.map((item) => ({...item}))
  }

  const find = (id) => {
    const item = items.find((one) => one.id === id)
    if (!item) throw new Error('nothing to approve with this id')
    return item
  }

  /** What the agent may do with this action now: the pause and its list, as for any action. */
  const decide = (agentId, action) => {
    const file = profiles.read()
    const agent = file.agents.find((one) => one.id === agentId)
    if (!agent) return {decision: 'off', reason: 'no such agent'}
    return checkAction(agentSettings(file, agent), action)
  }

  const remove = (id) => {
    items = items.filter((one) => one.id !== id)
  }

  /** The items waiting, oldest first, each with its agent's name. */
  const list = () => {
    const {agents} = profiles.read()
    return items.map((item) => ({
      ...item,
      agentName: (agents.find((one) => one.id === item.agentId) || {}).name,
    }))
  }

  return {
    list,
    /**
     * An action an agent prepared: refused when the agent may not do it, done by the caller when it may do it alone,
     * added to the list when it asks first. Returns {decision, reason, item?}.
     */
    propose({agentId, action, body, detail, editable} = {}) {
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
        return {decision: 'off', reason: 'unknown action'}
      const check = decide(agentId, action)
      if (check.decision !== 'ask') return check
      if (items.length >= MAX_PENDING)
        return {decision: 'off', reason: 'too many actions waiting'}
      const item = {
        id: newId(),
        agentId,
        action,
        body: text(body, MAX_TEXT_LENGTH),
        detail: text(detail, MAX_DETAIL_LENGTH),
        editable: editable === true,
        at: now(),
        state: 'waiting',
        error: null,
      }
      items.push(item)
      log({agentId, action, decision: 'ask', detail: 'waits for approval'})
      changed()
      return {...check, item: {...item}}
    },
    commands: {
      pending: list,
      /**
       * The person approves: the item is handed to the renderer to run (`body` replaced by the person's edit when it
       * is editable). Refused, and taken off the list, when its agent may no longer do it (removed, paused, the
       * action turned Off).
       */
      approve(data) {
        const item = find(data && data.id)
        if (item.state !== 'waiting') throw new Error('already being done')
        const check = decide(item.agentId, item.action)
        if (check.decision === 'off') {
          if (check.reason !== 'paused') {
            remove(item.id)
            changed()
          }
          throw new Error(`the agent may not do it now (${check.reason})`)
        }
        if (item.editable && typeof data.body === 'string')
          item.body = text(data.body, MAX_TEXT_LENGTH)
        item.state = 'running'
        item.error = null
        changed()
        return {...item}
      },
      /** How the approved action went: done, off the list; failed, back to waiting with its error. */
      finish(data) {
        const item = find(data && data.id)
        if (item.state !== 'running') throw new Error('not being done')
        const detail = text(data.detail, MAX_DETAIL_LENGTH)
        if (data.ok === true) {
          remove(item.id)
          log({
            agentId: item.agentId,
            action: item.action,
            decision: 'approved',
            detail,
          })
        } else {
          item.state = 'waiting'
          item.error = detail || 'failed'
          log({
            agentId: item.agentId,
            action: item.action,
            decision: 'failed',
            detail: item.error,
          })
        }
        changed()
        return list()
      },
      decline(data) {
        const item = find(data && data.id)
        if (item.state !== 'waiting') throw new Error('already being done')
        remove(item.id)
        log({
          agentId: item.agentId,
          action: item.action,
          decision: 'declined',
          detail: '',
        })
        changed()
        return list()
      },
    },
    /**
     * After a change of the agents: an item whose agent is gone or whose action is Off leaves the list (one being
     * done stays until it is finished). The pause keeps the items: they wait for the resume.
     */
    prune() {
      const before = items.length
      items = items.filter((item) => {
        if (item.state === 'running') return true
        const {reason} = decide(item.agentId, item.action)
        return !['no such agent', 'action off', 'agent off'].includes(reason)
      })
      if (items.length !== before) changed()
    },
  }
}

module.exports = {MAX_PENDING, createPending}
