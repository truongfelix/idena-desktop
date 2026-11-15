const crypto = require('crypto')
const fs = require('fs-extra')
const {
  ACTIONS,
  LEVELS,
  defaultSettings,
  normalizeLimit,
  normalizeSettings,
  normalizeTipAmount,
} = require('./settings')

// The agents of this identity (B-243): several models, each with its own name, connection, instructions, actions,
// schedule and budget, kept by the main process in one JSON file of the user data folder (never a key: see
// key.js). An agent may do only the actions in its list; the list starts empty. One flag pauses them all.
//
// A setup of the single agent (settings.json, before B-243) reads as one "Validation agent". That file is left as
// it is: an older build still reads it (its own setup, without the changes made here since).

const FORMAT = 1
const MAX_AGENTS = 20
const MAX_NAME_LENGTH = 60
const MAX_INSTRUCTIONS_LENGTH = 20000
const ID_PATTERN = /^[0-9a-f]{16}$/u

/** When an agent runs: at each validation, every hour, every day at a time, or only when the person asks. */
const SCHEDULES = ['validation', 'hourly', 'daily', 'manual']
const DEFAULT_TIME = '09:00'

/**
 * What an agent does when it runs, beyond its actions: the daily joke of 3615 IDENA (B-237, the app writes its
 * frame and counts its tips). None: it only acts within its actions.
 */
const TASKS = ['joke']

/** The actions only one agent may hold: the validation has one agent answering it. */
const SINGLE_HOLDER_ACTIONS = ['answerFlip']

const newAgentId = () => crypto.randomBytes(8).toString('hex')
/** The id of the agent read from the single agent's setup. */
const SINGLE_AGENT_ID = '0000000000000001'

/** A text field, trimmed and cut to `max` characters (never emptied for being long). */
function text(value, max, fallback) {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback
}

function normalizeTime(value) {
  const match = /^(\d{2}):(\d{2})$/u.exec(
    typeof value === 'string' ? value : ''
  )
  return match && Number(match[1]) < 24 && Number(match[2]) < 60
    ? value
    : DEFAULT_TIME
}

/** The agent's actions: only known actions, each with a known level and a limit; absent = not in its list. */
function normalizeActions(value) {
  const saved = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    Object.keys(ACTIONS)
      .filter((name) => saved[name] && typeof saved[name] === 'object')
      .map((name) => {
        const row = saved[name]
        const fallback = ACTIONS[name]
        return [
          name,
          {
            level: LEVELS.includes(row.level) ? row.level : 'off',
            limit:
              'limit' in row
                ? normalizeLimit(row.limit, fallback.limit)
                : fallback.limit,
            ...('amount' in fallback
              ? {amount: normalizeTipAmount(row.amount, fallback.amount)}
              : {}),
          },
        ]
      })
  )
}

/** One agent, each field checked, a broken one replaced by its default; `id` given when the saved one is not one. */
function normalizeAgent(input, {id = newAgentId} = {}) {
  const value = input && typeof input === 'object' ? input : {}
  // The connection and the report thresholds are checked as the single agent's settings were.
  const {provider, address, model, reportThresholds} = normalizeSettings(value)
  const schedule =
    value.schedule && typeof value.schedule === 'object' ? value.schedule : {}
  // A number, or a number written as text; anything else (an empty field included) is no budget.
  const budget =
    typeof value.budgetPerDay === 'number' ||
    (typeof value.budgetPerDay === 'string' && value.budgetPerDay.trim())
      ? Number(value.budgetPerDay)
      : NaN
  return {
    id:
      typeof value.id === 'string' && ID_PATTERN.test(value.id)
        ? value.id
        : id(),
    name: text(value.name, MAX_NAME_LENGTH, '') || 'Agent',
    enabled: value.enabled === true,
    provider,
    address,
    model,
    // The model that draws pictures, on the same service (B-236 Make the images); '' = none.
    imageModel: text(value.imageModel, 200, ''),
    instructions: text(value.instructions, MAX_INSTRUCTIONS_LENGTH, ''),
    actions: normalizeActions(value.actions),
    schedule: {
      kind: SCHEDULES.includes(schedule.kind) ? schedule.kind : 'manual',
      time: normalizeTime(schedule.time),
    },
    budgetPerDay: !Number.isFinite(budget) || budget < 0 ? null : budget,
    reportThresholds,
    task: TASKS.includes(value.task) ? value.task : null,
  }
}

/**
 * The whole file: at most MAX_AGENTS agents, each id once (a repeated one gets a new id), and an action only one
 * agent may hold (answering the validation) kept by the first agent that lists it, taken out of the others.
 */
function normalizeAgents(input, options) {
  const value = input && typeof input === 'object' ? input : {}
  const list = Array.isArray(value.agents) ? value.agents : []
  const ids = new Set()
  const held = new Set()
  const agents = list.slice(0, MAX_AGENTS).map((saved) => {
    let agent = normalizeAgent(saved, options)
    if (ids.has(agent.id))
      agent = {...agent, id: ((options && options.id) || newAgentId)()}
    ids.add(agent.id)
    const actions = {...agent.actions}
    SINGLE_HOLDER_ACTIONS.forEach((name) => {
      if (!actions[name]) return
      if (held.has(name)) delete actions[name]
      else held.add(name)
    })
    return {...agent, actions}
  })
  return {v: FORMAT, paused: value.paused === true, agents}
}

/**
 * The single agent's setup (settings.json, before B-243) as the file of agents: one "Validation agent" holding the
 * validation's two actions at their levels, and each other action that was not Off; the pause carries over. A setup
 * never turned on and never connected (the defaults) gives no agent at all.
 */
function fromSingleAgent(input) {
  const old = normalizeSettings(input)
  const used =
    old.enabled ||
    old.model !== '' ||
    Boolean(input && input.provider !== undefined)
  if (!used) return {v: FORMAT, paused: old.paused, agents: []}
  const actions = Object.fromEntries(
    Object.entries(old.permissions).filter(
      ([name, row]) =>
        name === 'answerFlip' || name === 'report' || row.level !== 'off'
    )
  )
  return normalizeAgents({
    paused: old.paused,
    agents: [
      {
        // A fixed id: the agent read from the older setup keeps it from one read to the next, until written.
        id: SINGLE_AGENT_ID,
        name: 'Validation agent',
        enabled: old.enabled,
        provider: old.provider,
        address: old.address,
        model: old.model,
        actions,
        schedule: {kind: 'validation'},
        budgetPerDay: null,
        reportThresholds: old.reportThresholds,
      },
    ],
  })
}

/**
 * One agent as the permission check reads it (permissions.js): its connection, every action with a level (Off for an
 * action not in its list) and the shared pause. The check then refuses an action outside the list.
 */
function agentSettings(file, agent) {
  return {
    enabled: agent.enabled,
    paused: file.paused,
    provider: agent.provider,
    address: agent.address,
    model: agent.model,
    permissions: Object.fromEntries(
      Object.entries(ACTIONS).map(([name, fallback]) => [
        name,
        agent.actions[name] || {...fallback, level: 'off'},
      ])
    ),
    reportThresholds: agent.reportThresholds,
  }
}

/** The agent that answers the validation (the one holding "Answer the flips"), or null. */
const validationAgent = (file) =>
  file.agents.find((agent) => agent.actions.answerFlip) || null

/**
 * The file of agents (`file`), read with its defaults; with none yet, the single agent's setup (`singleFile`) read
 * as one agent, written to `file` only at the first change.
 */
function createAgentProfiles({file, singleFile, logger}) {
  const readJson = (path) => {
    try {
      return {value: fs.readJsonSync(path)}
    } catch (error) {
      if (error.code !== 'ENOENT' && logger)
        logger.warn(`agent file unreadable: ${path}`, error.toString())
      return {missing: error.code === 'ENOENT'}
    }
  }
  return {
    read() {
      const saved = readJson(file())
      if (saved.value) return normalizeAgents(saved.value)
      // An unreadable file of agents is not replaced by the older setup: its agents would come back.
      if (!saved.missing || !singleFile)
        return {v: FORMAT, paused: false, agents: []}
      const single = readJson(singleFile())
      return single.value
        ? fromSingleAgent(single.value)
        : {v: FORMAT, paused: false, agents: []}
    },
    write(value) {
      const normalized = normalizeAgents(value)
      // Written beside, then renamed over the file: a power cut leaves the old file or the new one, never half.
      const temp = `${file()}.tmp`
      fs.outputJsonSync(temp, normalized, {spaces: 2})
      fs.renameSync(temp, file())
      return normalized
    },
  }
}

/**
 * The validation agent as the single agent's settings (settings.js): what the validation reads (and Settings › Agent read, until B-243 step 7)
 * and write until the Agents section replaces them (B-243). Reading: the agent holding "Answer the flips", or the
 * defaults (off) with none. Writing: that agent's connection, report thresholds and its two validation actions,
 * and the shared pause; its other actions stay. With no such agent yet, a write adds a "Validation agent" first.
 */
function validationAgentSettings(profiles) {
  const read = () => {
    const file = profiles.read()
    const agent = validationAgent(file)
    return agent
      ? agentSettings(file, agent)
      : {...defaultSettings(), paused: file.paused}
  }
  return {
    read,
    write(settings) {
      const value = normalizeSettings(settings)
      const file = profiles.read()
      const current = validationAgent(file)
      const updated = {
        ...(current || {
          name: 'Validation agent',
          schedule: {kind: 'validation'},
          actions: {},
        }),
        enabled: value.enabled,
        provider: value.provider,
        address: value.address,
        model: value.model,
        reportThresholds: value.reportThresholds,
      }
      updated.actions = {
        ...updated.actions,
        answerFlip: value.permissions.answerFlip,
        report: value.permissions.report,
      }
      const agents = current
        ? file.agents.map((agent) =>
            agent.id === current.id ? updated : agent
          )
        : [updated, ...file.agents]
      profiles.write({...file, paused: value.paused, agents})
      return read()
    },
  }
}

module.exports = {
  MAX_AGENTS,
  SCHEDULES,
  SINGLE_HOLDER_ACTIONS,
  TASKS,
  agentSettings,
  createAgentProfiles,
  fromSingleAgent,
  normalizeAgent,
  normalizeAgents,
  validationAgent,
  validationAgentSettings,
}
