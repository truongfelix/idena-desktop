const fs = require('fs-extra')

// The agent's settings, kept by the main process in one JSON file of the user data folder (never the API key: see
// key.js). The renderer reads and changes them only through the agent channel (ipc.js), which normalizes each one.

/** Where the model runs: a server on this computer, an OpenAI-compatible service, the Anthropic API. */
const PROVIDERS = ['local', 'openai', 'anthropic']

/** The address each provider starts with (Ollama's OpenAI-compatible server for "local"). */
const DEFAULT_ADDRESSES = {
  local: 'http://127.0.0.1:11434/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
}

/** Off: the agent never does it. Ask: it suggests, the user clicks. Alone: it does it, within the limit. */
const LEVELS = ['off', 'ask', 'alone']

/**
 * The actions the agent can ask for, each with its default level and limit (`null`: none). The first version
 * acts in the validation only; the other actions are listed Off so a saved file already carries their rows.
 * `limit` counts actions per validation for `report`, iDNA per day for `send`.
 */
const ACTIONS = {
  answerFlip: {level: 'ask', limit: null},
  report: {level: 'ask', limit: null},
  send: {level: 'off', limit: 0},
  post: {level: 'off', limit: null},
  tip: {level: 'off', limit: 0},
  ads: {level: 'off', limit: null},
  oracleVote: {level: 'off', limit: null},
  invite: {level: 'off', limit: null},
}

const MAX_MODEL_LENGTH = 200
const MAX_ADDRESS_LENGTH = 2048

function defaultSettings() {
  return {
    enabled: false,
    paused: false,
    provider: 'local',
    address: DEFAULT_ADDRESSES.local,
    model: '',
    permissions: Object.fromEntries(
      Object.entries(ACTIONS).map(([name, value]) => [name, {...value}])
    ),
  }
}

function normalizeLimit(value, fallback) {
  if (value === null) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return number
}

/** Each saved or sent field checked, an unknown or broken one replaced by its default. */
function normalizeSettings(input) {
  const defaults = defaultSettings()
  const value = input && typeof input === 'object' ? input : {}
  const provider = PROVIDERS.includes(value.provider)
    ? value.provider
    : defaults.provider
  const address =
    typeof value.address === 'string' &&
    value.address.trim() &&
    value.address.length <= MAX_ADDRESS_LENGTH
      ? value.address.trim()
      : DEFAULT_ADDRESSES[provider]
  const model =
    typeof value.model === 'string' && value.model.length <= MAX_MODEL_LENGTH
      ? value.model.trim()
      : ''
  const saved =
    value.permissions && typeof value.permissions === 'object'
      ? value.permissions
      : {}
  const permissions = Object.fromEntries(
    Object.entries(defaults.permissions).map(([name, fallback]) => {
      const row =
        saved[name] && typeof saved[name] === 'object' ? saved[name] : {}
      return [
        name,
        {
          level: LEVELS.includes(row.level) ? row.level : fallback.level,
          limit:
            'limit' in row
              ? normalizeLimit(row.limit, fallback.limit)
              : fallback.limit,
        },
      ]
    })
  )
  return {
    enabled: value.enabled === true,
    paused: value.paused === true,
    provider,
    address,
    model,
    permissions,
  }
}

/** The settings file: read (defaults when missing or unreadable), written whole. */
function createAgentSettings({file, logger}) {
  return {
    read() {
      try {
        return normalizeSettings(fs.readJsonSync(file()))
      } catch (error) {
        if (error.code !== 'ENOENT' && logger)
          logger.warn(
            'agent settings unreadable, defaults used',
            error.toString()
          )
        return defaultSettings()
      }
    },
    write(settings) {
      const value = normalizeSettings(settings)
      fs.outputJsonSync(file(), value, {spaces: 2})
      return value
    },
  }
}

module.exports = {
  ACTIONS,
  DEFAULT_ADDRESSES,
  LEVELS,
  PROVIDERS,
  createAgentSettings,
  defaultSettings,
  normalizeSettings,
}
