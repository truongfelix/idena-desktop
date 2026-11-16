const crypto = require('crypto')
const fs = require('fs-extra')
const {criteriaField} = require('./criteria')
const {
  ACTIONS,
  LEVELS,
  defaultSettings,
  normalizeEffort,
  normalizeLimit,
  normalizeMaxTokens,
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
 * What an agent reads on Idena Social (B-255, notes/agent-areas.md): the posts (none, those of the last 24 hours, or
 * the last N), its notifications (likes, answers, tips to it), its private messages. Reading spends nothing: it is
 * what the model is sent.
 */
const POST_WINDOWS = ['off', 'day', 'count']
const MAX_POSTS_READ = 50
const DEFAULT_POSTS_READ = 10
/**
 * The events that start a run besides the schedule: a like, an answer, a tip or a private message to it, a post that
 * tags it (B-264).
 */
const EVENTS = ['like', 'answer', 'tip', 'message', 'tag']

/** The read actions (B-262): what the agent is given to read on Social, each on or off. */
const READ_ACTIONS = [
  'readPosts',
  'readOwnPosts',
  'readNotifications',
  'readMessages',
  'readTags',
]

/** The posts' window of Read all Social posts: the last 24 hours, or the last N posts. */
function postsWindow(row) {
  const count = Number(row.count)
  // B-281: the most posts of one run with the window of a day (1 to MAX_POSTS_READ), and the most a day (from 0);
  // each kept only when set, so a row saved before reads the same.
  const perRun = Number(row.perRun)
  const perDay = Number(row.perDay)
  return {
    ...(row.perRun !== null &&
    row.perRun !== '' &&
    Number.isInteger(perRun) &&
    perRun >= 1 &&
    perRun <= MAX_POSTS_READ
      ? {perRun}
      : {}),
    ...(row.perDay !== null &&
    row.perDay !== '' &&
    Number.isInteger(perDay) &&
    perDay >= 0
      ? {perDay}
      : {}),
    window: row.window === 'count' ? 'count' : 'day',
    count:
      Number.isInteger(count) && count >= 1 && count <= MAX_POSTS_READ
        ? count
        : DEFAULT_POSTS_READ,
  }
}

const isOn = (row) => Boolean(row) && row.level !== 'off'

/** What the agent reads, from its read actions: the Social run's view (digest.js). */
function readsOf(actions) {
  const posts = actions.readPosts
  return {
    posts: isOn(posts)
      ? {
          window: posts.window,
          count: posts.count,
          ...(typeof posts.perRun === 'number' ? {perRun: posts.perRun} : {}),
          ...(typeof posts.perDay === 'number' ? {perDay: posts.perDay} : {}),
        }
      : {window: 'off', count: (posts && posts.count) || DEFAULT_POSTS_READ},
    own: isOn(actions.readOwnPosts),
    notifications: isOn(actions.readNotifications),
    messages: isOn(actions.readMessages),
    // The posts that tag it (B-264), at most `perDay` a day (null: no limit).
    tags: isOn(actions.readTags)
      ? {
          perDay:
            typeof actions.readTags.limit === 'number'
              ? Math.floor(actions.readTags.limit)
              : null,
        }
      : null,
  }
}

/**
 * The read actions of an agent saved before they were actions (B-255: its `reads`; B-239: readsBefore): what it read
 * then, on; its own posts when it held Post (they came with it).
 */
function readActionsBefore(value, actions) {
  const reads = normalizeReads(
    value.reads === undefined ? readsBefore(value) : value.reads
  )
  const on = {level: 'alone', limit: null}
  return {
    ...(reads.posts.window !== 'off'
      ? {readPosts: {...on, ...postsWindow(reads.posts)}}
      : {}),
    ...(isOn(actions.post) ? {readOwnPosts: on} : {}),
    ...(reads.notifications ? {readNotifications: on} : {}),
    ...(reads.messages ? {readMessages: on} : {}),
  }
}

function normalizeReads(value) {
  const reads = value && typeof value === 'object' ? value : {}
  const posts =
    reads.posts && typeof reads.posts === 'object' ? reads.posts : {}
  const count = Number(posts.count)
  return {
    posts: {
      window: POST_WINDOWS.includes(posts.window) ? posts.window : 'off',
      count:
        Number.isInteger(count) && count >= 1 && count <= MAX_POSTS_READ
          ? count
          : DEFAULT_POSTS_READ,
    },
    notifications: reads.notifications === true,
    messages: reads.messages === true,
  }
}

/**
 * What an agent saved before it had its own reads (B-239 builds) read: with a Social action not Off, the new posts (up
 * to 20); with one that answers others (not Post alone), its answers, likes and tips; with Private messages, its
 * messages. Without one, nothing.
 */
function readsBefore(value) {
  const saved =
    value.actions && typeof value.actions === 'object' ? value.actions : {}
  // A joke agent (B-237) read only its own jokes and the tips on them: its notifications, no one's posts.
  if (value.task === 'joke' && saved.post && saved.post.level !== 'off')
    return {
      posts: {window: 'off', count: 10},
      notifications: true,
      messages: false,
    }
  // As the B-239 builds read: from the Social actions not Off.
  const held = ['post', 'reply', 'like', 'message', 'tip'].filter(
    (name) => saved[name] && saved[name].level !== 'off'
  )
  if (!held.length) return undefined
  return {
    posts: {window: 'count', count: 20},
    notifications: held.some((name) => name !== 'post'),
    messages: held.includes('message'),
  }
}

const normalizeEvents = (value) =>
  Array.isArray(value) ? EVENTS.filter((one) => value.includes(one)) : []

/**
 * The actions only one agent may hold: the validation has one agent answering it and one reporting (the same agent,
 * or two: B-257).
 */
const SINGLE_HOLDER_ACTIONS = ['answerFlip', 'report']

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
            // The money limits of an action (B-269): a number from 0, or none (null).
            ...Object.fromEntries(
              ['spendPerDay', 'picturesPerDay']
                .filter((field) => field in fallback)
                .map((field) => [
                  field,
                  field in row
                    ? normalizeLimit(row[field], fallback[field])
                    : fallback[field],
                ])
            ),
            ...(name === 'readPosts' ? postsWindow(row) : {}),
            // Whose it reads, whom it acts on (B-266): kept only when one is set.
            ...criteriaField(name, row),
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
  let actions = normalizeActions(value.actions)
  // Saved before reads were actions (its reads without `own`, which every later save holds, or none at all): the
  // reads it had become its read actions, once. Never after: a read removed stays removed.
  const beforeReadActions =
    !(value.reads && typeof value.reads === 'object' && 'own' in value.reads) &&
    !READ_ACTIONS.some((name) => value.actions && value.actions[name])
  if (beforeReadActions)
    actions = {...actions, ...readActionsBefore(value, actions)}
  // Saved before the Flips area's steps were rights of their own (B-258: no `flipSteps`): an agent whose "Write flip
  // stories" drew the pictures (an image model set) holds Make the pictures at the same level, with its pictures a
  // day. Once: a later save carries the mark, and a removed Make the pictures stays removed.
  if (value.flipSteps !== true) actions = withFlipPictures(value, actions)
  // What a build before B-258 reads: its stories draw within flipStory's pictures a day. Without Make the pictures
  // (or Off), none (0): a downgrade does not draw more than this build.
  if (actions.flipStory)
    actions = {
      ...actions,
      flipStory: {
        ...actions.flipStory,
        picturesPerDay:
          actions.flipPictures && actions.flipPictures.level !== 'off'
            ? actions.flipPictures.picturesPerDay
            : 0,
      },
    }
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
    actions,
    // Derived from its read actions, never set apart (B-262).
    reads: readsOf(actions),
    events: normalizeEvents(value.events),
    schedule: {
      kind: SCHEDULES.includes(schedule.kind) ? schedule.kind : 'manual',
      time: normalizeTime(schedule.time),
    },
    budgetPerDay: !Number.isFinite(budget) || budget < 0 ? null : budget,
    // The model's longest answer (null: the app's choice for each task) and its effort ('': the model's default).
    maxTokens: normalizeMaxTokens(value.maxTokens),
    effort: normalizeEffort(value.effort),
    reportThresholds,
    // Its actions read with the Flips area's steps (B-258): see withFlipPictures.
    flipSteps: true,
  }
}

/** The actions of an agent saved before B-258 (withFlipPictures' caller): Make the pictures where its stories drew. */
function withFlipPictures(value, actions) {
  const story = actions.flipStory
  const saved = value.actions && value.actions.flipStory
  if (!story || actions.flipPictures || !text(value.imageModel, 200, ''))
    return actions
  // 0: this build wrote it for a Make the pictures removed or Off (a round trip through an older build): it stays so.
  if (saved && saved.picturesPerDay === 0) return actions
  const perDay =
    saved && 'picturesPerDay' in saved
      ? normalizeLimit(saved.picturesPerDay, null)
      : null
  return {
    ...actions,
    flipPictures: {level: story.level, limit: null, picturesPerDay: perDay},
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
  const agents = list.slice(0, MAX_AGENTS).map((saved) => {
    const agent = normalizeAgent(saved, options)
    if (!ids.has(agent.id)) {
      ids.add(agent.id)
      return agent
    }
    const id = ((options && options.id) || newAgentId)()
    ids.add(id)
    return {...agent, id}
  })
  // Each action only one agent may hold stays with one: the first that lists it; the reports, with the agent
  // answering when it has them too (a file from before B-257 could hold them twice).
  const answering = agents.find((agent) => agent.actions.answerFlip)
  const holderOf = (name) =>
    name === 'report' && answering && answering.actions.report
      ? answering
      : agents.find((agent) => agent.actions[name])
  SINGLE_HOLDER_ACTIONS.forEach((name) => {
    const holder = holderOf(name)
    agents.forEach((agent, i) => {
      if (agent === holder || !agent.actions[name]) return
      const actions = {...agent.actions}
      delete actions[name]
      agents[i] = {...agent, actions}
    })
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

/** The agent that reports flips in the validation (the one holding "Report flips"), or null. */
const reportAgent = (file) =>
  file.agents.find((agent) => agent.actions.report) || null

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
  // The agent answering and the one reporting (B-257), seen as one: the connection of the answering agent (else the
  // reporting one), each action's level from the agent holding it while that agent is on.
  const read = () => {
    const file = profiles.read()
    const answering = validationAgent(file)
    const reporting = reportAgent(file)
    const base = answering || reporting
    if (!base) return {...defaultSettings(), paused: file.paused}
    const settings = agentSettings(file, base)
    const levelOf = (agent, name) =>
      agent && agent.enabled
        ? agent.actions[name]
        : {...settings.permissions[name], level: 'off'}
    return {
      ...settings,
      enabled: Boolean(
        (answering && answering.enabled) || (reporting && reporting.enabled)
      ),
      permissions: {
        ...settings.permissions,
        answerFlip: levelOf(answering, 'answerFlip'),
        report: levelOf(reporting, 'report'),
      },
    }
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
      // Another agent's report stays its own (B-257).
      const reporting = reportAgent(file)
      const reportsElsewhere =
        reporting && (!current || reporting.id !== current.id)
      updated.actions = {
        ...updated.actions,
        answerFlip: value.permissions.answerFlip,
        ...(reportsElsewhere ? {} : {report: value.permissions.report}),
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
  EVENTS,
  READ_ACTIONS,
  MAX_AGENTS,
  MAX_POSTS_READ,
  POST_WINDOWS,
  SCHEDULES,
  SINGLE_HOLDER_ACTIONS,
  agentSettings,
  createAgentProfiles,
  fromSingleAgent,
  normalizeAgent,
  normalizeAgents,
  reportAgent,
  validationAgent,
  validationAgentSettings,
}
