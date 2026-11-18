const {DEFAULT_ADDRESSES} = require('./settings')
const {SINGLE_HOLDER_ACTIONS, normalizeAgent} = require('./profiles')

// One agent as a file (B-243, owner 2026-11-14 "like skills"): its name, instructions, its actions with
// their levels and limits, when it runs, its model and its budget, the report thresholds. Never the key, nor the
// Activity. The service's address goes in only when it is the service's public default: another may hold a secret
// (a token in the address) or a private server. An imported agent starts off, each action Off, until the person
// turns each one on. Nor its own parts of the app's text (B-282): a file cannot bring a text in place of the app's
// (its safeguard, its format) that the import does not show; a part is unlocked by the person, on their computer.

const FORMAT = 'idena-agent'
const VERSION = 1
/** A file larger than this is no agent (its instructions are at most 20,000 characters). */
const MAX_FILE_LENGTH = 200000

/** The file's text for `agent` (as profiles.js keeps it). */
function exportAgent(agent) {
  const {provider, address} = agent
  return JSON.stringify(
    {
      format: FORMAT,
      v: VERSION,
      name: agent.name,
      instructions: agent.instructions,
      provider,
      ...(address === DEFAULT_ADDRESSES[provider] ? {address} : {}),
      model: agent.model,
      ...(agent.imageModel ? {imageModel: agent.imageModel} : {}),
      ...(agent.maxTokens ? {maxTokens: agent.maxTokens} : {}),
      ...(agent.effort ? {effort: agent.effort} : {}),
      // Its internet (B-294), when it is not Off: an older build ignores it, and imports the agent without it.
      ...(agent.internet && agent.internet.mode !== 'off'
        ? {internet: agent.internet}
        : {}),
      actions: agent.actions,
      reads: agent.reads,
      events: agent.events,
      schedule: agent.schedule,
      budgetPerDay: agent.budgetPerDay,
      reportThresholds: agent.reportThresholds,
    },
    null,
    2
  )
}

/** A file name for the agent's file: its name in plain letters. */
function agentFileName(agent) {
  const base =
    agent.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .slice(0, 40)
      .replace(/^-+|-+$/gu, '') || 'agent'
  return `${base}.idena-agent.json`
}

/**
 * The agent a file holds, as it will be added: checked field by field, off, each action Off (what the file asked
 * for kept in `asked`), the actions only one agent may hold left out when another agent holds them (`dropped`).
 * Throws when the text is no agent file.
 */
function readAgentFile(text, agents = []) {
  if (typeof text !== 'string' || text.length > MAX_FILE_LENGTH)
    throw new Error('not an agent file')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('not an agent file')
  }
  if (!value || value.format !== FORMAT || value.v !== VERSION)
    throw new Error('not an agent file')
  const read = normalizeAgent({
    ...value,
    id: undefined,
    enabled: false,
    appParts: undefined,
    // Only the service's public default address comes from a file, as only it goes into one: another (a server
    // that would get the key and what the agent reads) is set by the person on the agent's page.
    address:
      typeof value.address === 'string' &&
      value.address === DEFAULT_ADDRESSES[value.provider]
        ? value.address
        : '',
  })
  const addressLeft =
    typeof value.address === 'string' &&
    value.address !== '' &&
    value.address !== read.address
  const dropped = SINGLE_HOLDER_ACTIONS.filter(
    (name) => read.actions[name] && agents.some((one) => one.actions[name])
  )
  const asked = Object.fromEntries(
    Object.entries(read.actions).filter(([name]) => !dropped.includes(name))
  )
  const actions = Object.fromEntries(
    Object.entries(asked).map(([name, row]) => [name, {...row, level: 'off'}])
  )
  // Its reads follow its actions, Off as imported (B-262).
  return {
    agent: {...read, actions, reads: normalizeAgent({...read, actions}).reads},
    asked,
    dropped,
    addressLeft,
  }
}

module.exports = {
  FORMAT,
  MAX_FILE_LENGTH,
  agentFileName,
  exportAgent,
  readAgentFile,
}
