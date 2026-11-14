const crypto = require('crypto')
const fs = require('fs-extra')
const {ACTIONS} = require('./settings')
const {checkAction} = require('./permissions')
const {agentSettings} = require('./profiles')

// "To approve" (B-243): the actions the agents prepared with Ask me, across the agents, each waiting for the
// person's click. The main process keeps the list and decides; the renderer shows it, and runs an approved action
// with the app's own code (as the person's click would), then says how it went. Kept in a file of the user data
// folder (pending.json), so a joke prepared at 09:00 still waits after a restart.

const MAX_PENDING = 50
/** One agent's share of the list: an agent proposing too often cannot shut the others out. */
const MAX_PENDING_PER_AGENT = 20
const MAX_TEXT_LENGTH = 10000
const MAX_DETAIL_LENGTH = 500

const newPendingId = () => crypto.randomBytes(8).toString('hex')

const text = (value, max) =>
  typeof value === 'string' ? value.slice(0, max) : ''

const ID_PATTERN = /^[0-9a-f]{16}$/u
const INTERRUPTED =
  'interrupted: it may have been done, check before approving again'

/**
 * One saved item, each field checked, or null. One being done when the app closed waits again, with the warning:
 * nobody heard how it went.
 */
function readItem(value) {
  if (!value || typeof value !== 'object') return null
  if (!ID_PATTERN.test(value.id) || !ID_PATTERN.test(value.agentId)) return null
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, value.action)) return null
  const running = value.state === 'running'
  return {
    id: value.id,
    agentId: value.agentId,
    action: value.action,
    body: text(value.body, MAX_TEXT_LENGTH),
    detail: text(value.detail, MAX_DETAIL_LENGTH),
    editable: value.editable === true,
    at: Number.isFinite(value.at) ? value.at : 0,
    state: 'waiting',
    error: running ? INTERRUPTED : text(value.error, MAX_DETAIL_LENGTH) || null,
  }
}

/** The saved list (`file`), or none: missing, unreadable, or not this format. */
function readItems(file, logger) {
  if (!file) return []
  try {
    const saved = fs.readJsonSync(file())
    const list = saved && Array.isArray(saved.items) ? saved.items : []
    const ids = new Set()
    return list
      .map(readItem)
      .filter((item) => {
        if (!item || ids.has(item.id)) return false
        ids.add(item.id)
        return true
      })
      .slice(0, MAX_PENDING)
  } catch (error) {
    if (error.code !== 'ENOENT' && logger)
      logger.warn('agent pending file unreadable', error.toString())
    return []
  }
}

/**
 * The list over `profiles` (the file of agents), kept in `file` (none: until the app closes). `log(entry)` adds an
 * Activity line, `notify()` tells the window the list changed.
 */
function createPending({
  profiles,
  log,
  file = null,
  logger = null,
  notify = () => {},
  now = Date.now,
  newId = newPendingId,
}) {
  let items = readItems(file, logger)
  // What each agent spent today in iDNA (fees included) on the actions it did alone: {agentId: {day, total}}.
  const spent = new Map()
  const today = () => new Date(now()).toDateString()
  const spentToday = (agentId) => {
    const entry = spent.get(agentId)
    return entry && entry.day === today() ? entry.total : 0
  }

  /**
   * An action the agent may do alone, within its daily budget: `cost` in iDNA, fees included. No budget: it may
   * spend nothing alone, the action waits for the person.
   */
  const withinBudget = (agentId, cost) => {
    if (!(cost > 0)) return {decision: 'alone', reason: 'within the limit'}
    const agent = profiles.read().agents.find((one) => one.id === agentId)
    const budget = agent ? agent.budgetPerDay : null
    if (budget === null) return {decision: 'ask', reason: 'no budget'}
    return spentToday(agentId) + cost > budget
      ? {decision: 'ask', reason: 'above the budget'}
      : {decision: 'alone', reason: 'within the limit'}
  }

  // Written beside, then renamed over the file: a power cut leaves the old list or the new one, never half. A
  // failed write keeps the list in memory: the change holds until the app closes.
  const save = () => {
    if (!file) return
    try {
      const temp = `${file()}.tmp`
      fs.outputJsonSync(temp, {v: 1, items}, {spaces: 2})
      fs.renameSync(temp, file())
    } catch (error) {
      if (logger)
        logger.warn('agent pending file not written', error.toString())
    }
  }

  const changed = () => {
    save()
    notify()
    return items.map((item) => ({...item}))
  }

  const find = (id) => {
    const item = items.find((one) => one.id === id)
    if (!item) throw new Error('nothing to approve with this id')
    return item
  }

  /**
   * What the agent may do with this action now: the pause, its list and the action's limit (`usage` already done in
   * the limit's span, `amount` this action adds), as for any action. `agentsFile`: the agents, read once by the caller.
   */
  const decide = (
    agentId,
    action,
    counts = {},
    agentsFile = profiles.read()
  ) => {
    const agent = agentsFile.agents.find((one) => one.id === agentId)
    if (!agent) return {decision: 'off', reason: 'no such agent'}
    return checkAction(agentSettings(agentsFile, agent), action, counts)
  }

  /** Takes the item off the list; `reason` (not done) goes in the agent's Activity. */
  const remove = (id, reason) => {
    const item = items.find((one) => one.id === id)
    items = items.filter((one) => one.id !== id)
    if (item && reason)
      log({
        agentId: item.agentId,
        action: item.action,
        decision: 'dropped',
        detail: reason,
      })
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
    propose({
      agentId,
      action,
      body,
      detail,
      editable,
      usage,
      amount,
      cost,
    } = {}) {
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
        return {decision: 'off', reason: 'unknown action'}
      // The limit is checked on what the action spends: above it, the action waits for the person; so does an
      // action that would pass the agent's daily budget (`cost`: iDNA, fees included).
      let check = decide(agentId, action, {
        ...(usage !== undefined ? {usage} : {}),
        ...(amount !== undefined ? {amount} : {}),
      })
      if (check.decision === 'alone')
        check = withinBudget(agentId, Number(cost))
      if (check.decision !== 'ask') return check
      if (
        items.length >= MAX_PENDING ||
        items.filter((one) => one.agentId === agentId).length >=
          MAX_PENDING_PER_AGENT
      )
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
      log({agentId, action, decision: 'ask', detail: ''})
      changed()
      return {...check, item: {...item}}
    },
    commands: {
      pending: list,
      /**
       * An action the agent did alone (after a propose that said so): logged, and what it spent counted in its
       * budget of the day.
       */
      didAction(data) {
        const {agentId, action} = data || {}
        if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
          throw new Error('unknown action')
        if (!profiles.read().agents.some((one) => one.id === agentId))
          throw new Error('no such agent')
        const cost = Number(data.cost)
        if (data.ok === true && cost > 0)
          spent.set(agentId, {day: today(), total: spentToday(agentId) + cost})
        log({
          agentId,
          action,
          decision: data.ok === true ? 'alone' : 'failed',
          detail: text(data.detail, MAX_DETAIL_LENGTH),
        })
        return null
      },
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
            remove(item.id, check.reason)
            changed()
          }
          throw new Error(`the agent may not do it now (${check.reason})`)
        }
        if (item.editable && typeof data.body === 'string') {
          if (!data.body.trim()) throw new Error('the text is empty')
          item.body = text(data.body, MAX_TEXT_LENGTH)
        }
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
      const agentsFile = profiles.read()
      const gone = items.filter((item) => {
        if (item.state === 'running') return false
        const {reason} = decide(item.agentId, item.action, {}, agentsFile)
        return ['no such agent', 'action off', 'agent off'].includes(reason)
      })
      gone.forEach((item) =>
        remove(
          item.id,
          decide(item.agentId, item.action, {}, agentsFile).reason
        )
      )
      if (gone.length) changed()
    },
    /**
     * The window was loaded again (a reload, a crash): an action it was doing never said how it went. It waits again,
     * with a warning: it may have been done.
     */
    interrupted() {
      const running = items.filter((item) => item.state === 'running')
      running.forEach((item) => {
        item.state = 'waiting'
        item.error = INTERRUPTED
        log({
          agentId: item.agentId,
          action: item.action,
          decision: 'failed',
          detail: item.error,
        })
      })
      if (running.length) changed()
    },
  }
}

module.exports = {MAX_PENDING, MAX_PENDING_PER_AGENT, createPending}
