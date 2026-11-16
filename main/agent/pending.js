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
/**
 * The actions whose limit counts them per day (posts, replies, likes, private messages); a tip's limit counts the
 * iDNA tipped per day (DAILY_AMOUNT_ACTIONS), never its fees: it lets no tip go alone (B-269: the action's own iDNA a
 * day, fees included, or the overall limit does); the others count iDNA sent, or per validation.
 */
const DAILY_COUNT_ACTIONS = new Set([
  'post',
  'reply',
  'like',
  'message',
  // The Flips area's steps in a run (B-258): each one's actions a day.
  'flipStory',
  'flipPictures',
  'flipDraft',
  'flipJudge',
  'flipSubmit',
  'flipDelete',
])
const DAILY_AMOUNT_ACTIONS = new Set(['tip'])
const MAX_DETAIL_LENGTH = 500
/**
 * The reasons an action Alone would wait for the person: past what it may spend or do today, no budget to spend
 * from, a cost not known. A Social run skips it instead (OVER_LIMIT).
 */
const OVER_LIMIT = [
  'above the limit',
  'above its daily iDNA',
  'above the budget',
  'no budget',
  'cost unknown',
  'count unknown',
]
/** What an action is done on (a post's id, a conversation's people), as the app's code wrote it: at most this long. */
const MAX_TARGET_LENGTH = 2000

/** What one action of `action` adds to its day's count: 1, its iDNA (a tip), or nothing (not counted per day). */
function dailyCount(action, amount) {
  if (DAILY_COUNT_ACTIONS.has(action)) return 1
  if (DAILY_AMOUNT_ACTIONS.has(action))
    return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
      ? amount
      : 0
  return 0
}

const isDaily = (action) =>
  DAILY_COUNT_ACTIONS.has(action) || DAILY_AMOUNT_ACTIONS.has(action)

/** A target the app's code gave (a plain object, JSON-sized), or null. */
function readTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const json = JSON.stringify(value)
    return json.length <= MAX_TARGET_LENGTH ? JSON.parse(json) : null
  } catch {
    return null
  }
}

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
    target: readTarget(value.target),
    amount:
      Number.isFinite(value.amount) && value.amount > 0 ? value.amount : null,
    at: Number.isFinite(value.at) ? value.at : 0,
    state: 'waiting',
    error: running ? INTERRUPTED : text(value.error, MAX_DETAIL_LENGTH) || null,
  }
}

/**
 * The day's tally saved with the list, or an empty one; another day's starts again: {day, spent (by agent), done (by
 * agent and action; 'flipImage' counts the pictures drawn), spentBy (by agent and action, B-269), before (a tally a
 * build before B-269 began: each action counts all the agent spent)}.
 */
function readTally(saved, day) {
  const tally = saved && saved.tally
  const numbers = (value) =>
    Object.fromEntries(
      Object.entries(value && typeof value === 'object' ? value : {}).filter(
        ([, n]) => typeof n === 'number' && Number.isFinite(n) && n >= 0
      )
    )
  return tally && tally.day === day
    ? {
        day,
        spent: numbers(tally.spent),
        done: numbers(tally.done),
        // By agent and action (B-269): each action's own iDNA a day. A tally saved before has none: each action
        // counts as having spent all the agent spent today.
        spentBy: numbers(tally.spentBy),
        // Kept in the file until the day ends: a restart still counts what the build before spent.
        ...(tally.before === true ||
        !(tally.spentBy && typeof tally.spentBy === 'object')
          ? {before: true}
          : {}),
      }
    : {day, spent: {}, done: {}, spentBy: {}}
}

function readSaved(file, logger) {
  if (!file) return null
  try {
    return fs.readJsonSync(file())
  } catch (error) {
    if (error.code !== 'ENOENT' && logger)
      logger.warn('agent pending file unreadable', error.toString())
    return null
  }
}

/** The saved list, or none: missing, unreadable, or not this format. */
function readItems(saved) {
  if (!saved) return []
  {
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
  const today = () => new Date(now()).toDateString()
  const saved = readSaved(file, logger)
  let items = readItems(saved)
  // The day's tally, kept with the list (a restart keeps it): what each agent spent in iDNA (fees included) on the
  // actions it did alone, and the actions of a daily count done (alone, or approved), by agent and action. A post
  // counts from the moment it goes alone (two runs at once cannot both post), until it is known never sent.
  let tally = readTally(saved, today())
  const current = () => {
    if (tally.day !== today())
      tally = {day: today(), spent: {}, done: {}, spentBy: {}}
    return tally
  }
  const spentToday = (agentId) => current().spent[agentId] || 0
  const spentByToday = (agentId, action) =>
    Math.max(
      current().spentBy[`${agentId}:${action}`] || 0,
      current().before ? spentToday(agentId) : 0
    )
  const doneToday = (agentId, action) =>
    current().done[`${agentId}:${action}`] || 0
  const addTally = (agentId, action, {n = 0, cost = 0} = {}) => {
    const day = current()
    const key = `${agentId}:${action}`
    if (n) day.done[key] = Math.max(0, (day.done[key] || 0) + n)
    if (cost) {
      day.spent[agentId] = Math.max(0, (day.spent[agentId] || 0) + cost)
      day.spentBy[key] = Math.max(0, (day.spentBy[key] || 0) + cost)
    }
  }

  /** The amount of the agent's row for an action counted in iDNA (a tip), else undefined. */
  const rowAmount = (agentId, action) => {
    if (!DAILY_AMOUNT_ACTIONS.has(action)) return undefined
    const agent = profiles.read().agents.find((one) => one.id === agentId)
    return agent && agent.actions[action] ? agent.actions[action].amount : 0
  }

  /**
   * An action the agent may do alone, within what it may spend a day: `cost` in iDNA, fees included (B-269). A limit
   * must cover it, the action's own iDNA a day or the agent's overall one (budgetPerDay), and each one set must have
   * room. No limit at all: it may spend nothing alone, the action waits for the person, as before B-269.
   */
  const withinBudget = (agentId, action, cost) => {
    // A cost the caller did not give, or not a number, is unknown: the person decides.
    if (!(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0))
      return {decision: 'ask', reason: 'cost unknown'}
    if (cost === 0) return {decision: 'alone', reason: 'within the limit'}
    const agent = profiles.read().agents.find((one) => one.id === agentId)
    const row = agent && agent.actions[action]
    const own =
      row && typeof row.spendPerDay === 'number' ? row.spendPerDay : null
    const overall = agent ? agent.budgetPerDay : null
    // A tip's daily amount counts the iDNA tipped, never its fees: it covers nothing alone.
    if (own === null && overall === null)
      return {decision: 'ask', reason: 'no budget'}
    if (own !== null && spentByToday(agentId, action) + cost > own)
      return {decision: 'ask', reason: 'above its daily iDNA'}
    if (overall !== null && spentToday(agentId) + cost > overall)
      return {decision: 'ask', reason: 'above the budget'}
    return {decision: 'alone', reason: 'within the limit'}
  }

  // Written beside, then renamed over the file: a power cut leaves the old list or the new one, never half. A
  // failed write keeps the list in memory: the change holds until the app closes.
  const save = () => {
    if (!file) return
    try {
      const temp = `${file()}.tmp`
      fs.outputJsonSync(temp, {v: 1, items, tally: current()}, {spaces: 2})
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
      target,
      usage,
      amount: given,
      cost: givenCost,
      skipOverLimit,
    } = {}) {
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
        return {decision: 'off', reason: 'unknown action'}
      // A tip's amount is the person's, from the agent's row: whatever the caller says (a model's answer) changes
      // nothing. Its cost must hold it.
      let amount = given
      let cost = givenCost
      if (DAILY_AMOUNT_ACTIONS.has(action)) {
        const agent = profiles.read().agents.find((one) => one.id === agentId)
        const row = agent && agent.actions[action]
        if (!row) return {decision: 'off', reason: 'action off'}
        amount = row.amount
        if (!(typeof cost === 'number' && cost >= amount)) cost = undefined
      }
      // The limit is checked on what the action spends: above it, the action waits for the person; so does an
      // action that would pass the agent's daily budget (`cost`: iDNA, fees included).
      // A daily count also counts what the main process saw done today (a post just sent is not scanned yet). A
      // usage that is not a count stays as it is: the check then asks the person ("count unknown").
      const counted = isDaily(action) ? doneToday(agentId, action) : 0
      const isCount = typeof usage === 'number' && Number.isFinite(usage)
      let counts = usage !== undefined ? {usage} : {}
      if (counted && (isCount || usage === undefined))
        counts = {usage: Math.max(isCount ? usage : 0, counted)}
      let check = decide(agentId, action, {
        ...counts,
        ...(amount !== undefined ? {amount} : {}),
      })
      if (check.decision === 'alone')
        check = withinBudget(agentId, action, cost)
      if (check.decision === 'alone') {
        // Counted now, not once done: a second run meanwhile finds the day's post taken and the budget spent.
        addTally(agentId, action, {n: dailyCount(action, amount), cost})
        save()
      }
      const withAmount = DAILY_AMOUNT_ACTIONS.has(action) ? {amount} : {}
      // An agent acting alone that reached its limit or budget (a Social run): the action is not done, and does not
      // wait in To approve either, where each run would add one more.
      if (
        skipOverLimit === true &&
        check.decision === 'ask' &&
        OVER_LIMIT.includes(check.reason)
      ) {
        log({agentId, action, decision: 'skipped', detail: check.reason})
        return {decision: 'skipped', reason: check.reason, ...withAmount}
      }
      if (check.decision !== 'ask') return {...check, ...withAmount}
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
        target: readTarget(target),
        amount: DAILY_AMOUNT_ACTIONS.has(action) ? amount : null,
        at: now(),
        state: 'waiting',
        error: null,
      }
      items.push(item)
      log({agentId, action, decision: 'ask', detail: ''})
      changed()
      return {...check, ...withAmount, item: {...item}}
    },
    commands: {
      pending: list,
      /**
       * What the agent may do with `action` now, nothing counted (B-258): a Flips run asks before a step whose work is
       * billed (a story, pictures, a judgement), so that a step past its limit asks the model nothing. The action
       * itself then goes through propose, which counts it.
       */
      mayDo(data) {
        const {agentId, action} = data || {}
        if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
          return {decision: 'off', reason: 'unknown action'}
        const counted = isDaily(action) ? doneToday(agentId, action) : 0
        const check = decide(agentId, action, {usage: counted})
        // Asking, but To approve has no room left for it: propose would refuse it after the work was paid for.
        if (
          check.decision === 'ask' &&
          (items.length >= MAX_PENDING ||
            items.filter((one) => one.agentId === agentId).length >=
              MAX_PENDING_PER_AGENT)
        )
          return {decision: 'off', reason: 'too many actions waiting'}
        return check
      },
      /**
       * How an action the agent did alone went (after a propose that said so, which counted it): logged. `release`:
       * it was never sent (refused before), its count and cost are given back to the day.
       */
      didAction(data) {
        const {agentId, action} = data || {}
        if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
          throw new Error('unknown action')
        if (!profiles.read().agents.some((one) => one.id === agentId))
          throw new Error('no such agent')
        const cost = Number(data.cost)
        if (data.ok !== true && data.release === true) {
          addTally(agentId, action, {
            // A tip gives back what propose counted: the agent's amount, never the caller's.
            n: -dailyCount(action, rowAmount(agentId, action)),
            cost: Number.isFinite(cost) && cost > 0 ? -cost : 0,
          })
          save()
        }
        // eslint-disable-next-line no-nested-ternary
        const decision = data.skipped
          ? 'skipped'
          : data.ok === true
          ? 'alone'
          : 'failed'
        log({
          agentId,
          action,
          decision,
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
          if (isDaily(item.action))
            addTally(item.agentId, item.action, {
              n: dailyCount(item.action, item.amount),
            })
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
      /** The agent takes back an item of its own still waiting (an older day's joke): said in its Activity. */
      withdraw(data) {
        const item = find(data && data.id)
        if (item.state !== 'waiting') throw new Error('already being done')
        if (item.agentId !== data.agentId) throw new Error('not its own')
        remove(item.id, text(data.reason, MAX_DETAIL_LENGTH) || 'withdrawn')
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
    /** The pictures the agent's service drew today (B-269), kept with the day's tally: a restart keeps them. */
    picturesToday: (agentId) => doneToday(agentId, 'flipImage'),
    /** One more picture asked of its service today (`n` -1: one given back, never billed). */
    addPicture(agentId, n = 1) {
      addTally(agentId, 'flipImage', {n})
      save()
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
