const fs = require('fs-extra')
const {REPORT_THRESHOLDS} = require('./flips')

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
 * acted in the validation only; the other actions are listed Off so a saved file already carries their rows.
 * `limit` counts actions per validation for `report`, iDNA per day for `send` and `tip`, actions per day for
 * `post`, `reply`, `like` and `message`. A tip's row also holds `amount`: the whole iDNA of each tip, set by the
 * person (the model only picks the posts).
 */
const ACTIONS = {
  answerFlip: {level: 'ask', limit: null},
  report: {level: 'ask', limit: null},
  send: {level: 'off', limit: 0},
  // `spendPerDay` (B-269): the most iDNA the action spends a day alone, fees included; null: none of its own (the
  // agent's overall limit, budgetPerDay, covers it, or the person decides).
  post: {level: 'off', limit: null, spendPerDay: null},
  // Idena Social (B-239): replies and comments, likes, private messages.
  reply: {level: 'off', limit: 5, spendPerDay: null},
  like: {level: 'off', limit: 10, spendPerDay: null},
  message: {level: 'off', limit: 3, spendPerDay: null},
  tip: {level: 'off', limit: 0, amount: 1, spendPerDay: null},
  // What it reads on Social, given like any action (B-262): on ('alone') or off. Reading spends nothing.
  readPosts: {level: 'off', limit: null},
  readOwnPosts: {level: 'off', limit: null},
  readNotifications: {level: 'off', limit: null},
  readMessages: {level: 'off', limit: null},
  ads: {level: 'off', limit: null},
  oracleVote: {level: 'off', limit: null},
  invite: {level: 'off', limit: null},
  // A flip's story and image prompts, written for the person in the flip editor (B-236); nothing reaches the chain.
  // `picturesPerDay` (B-269): the most pictures its service draws a day (each one is billed); null: no limit.
  flipStory: {level: 'off', limit: null, picturesPerDay: null},
}

const MAX_MODEL_LENGTH = 200

/**
 * The model's effort (B-265): how hard it thinks before answering; '' = the model's own default. The Anthropic API
 * takes all five; an OpenAI-compatible service takes low, medium and high (providers.js sends high for the two above).
 */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
/** The longest answer a person may set, in tokens (the largest any current model writes). */
const MAX_ANSWER_TOKENS = 128000

/** The longest answer an agent's model may write, in tokens: a whole number from 1, else null (the app's choice). */
function normalizeMaxTokens(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
    return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) return null
  return Math.min(number, MAX_ANSWER_TOKENS)
}

/** One of EFFORTS, else '' (the model's default). */
function normalizeEffort(value) {
  return EFFORTS.includes(value) ? value : ''
}
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
    reportThresholds: {...REPORT_THRESHOLDS},
  }
}

/** A report reason's threshold: a confidence from 0.5 to 1, in hundredths; anything else is the default. */
function normalizeThreshold(value, fallback) {
  const number = Number(value)
  if (value === null || value === '' || !Number.isFinite(number))
    return fallback
  if (number < 0.5 || number > 1) return fallback
  return Math.round(number * 100) / 100
}

/** A tip's amount: a whole number of iDNA from 1 (a tip's decimals are not counted by the apps), else `fallback`. */
function normalizeTipAmount(value, fallback) {
  const number = Number(value)
  if (value === null || value === '' || !Number.isInteger(number))
    return fallback
  return number >= 1 ? number : fallback
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
          ...('amount' in fallback
            ? {amount: normalizeTipAmount(row.amount, fallback.amount)}
            : {}),
          // The money limits of an action (B-269), as the agents' file keeps them.
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
        },
      ]
    })
  )
  const savedThresholds =
    value.reportThresholds && typeof value.reportThresholds === 'object'
      ? value.reportThresholds
      : {}
  const reportThresholds = Object.fromEntries(
    Object.entries(defaults.reportThresholds).map(([reason, fallback]) => [
      reason,
      normalizeThreshold(savedThresholds[reason], fallback),
    ])
  )
  return {
    enabled: value.enabled === true,
    paused: value.paused === true,
    provider,
    address,
    model,
    permissions,
    reportThresholds,
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
  EFFORTS,
  LEVELS,
  MAX_ANSWER_TOKENS,
  PROVIDERS,
  createAgentSettings,
  defaultSettings,
  normalizeEffort,
  normalizeLimit,
  normalizeMaxTokens,
  normalizeSettings,
  normalizeTipAmount,
}
