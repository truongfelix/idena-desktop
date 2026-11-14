const {checkAction} = require('./permissions')
const {createAgentCommands} = require('./agent-commands')
const {validationAgent} = require('./profiles')
const {checkFlip, flipQuestion, readFlipAnswer} = require('./flips')
const providers = require('./providers')

// The agent part of the main process: the renderer's one way to the agent (the "agent" channel). It keeps the
// settings and the key, checks each action before the model is asked, asks it, and logs what it did. The renderer
// then applies an answer the check allowed with the user's own code (a click), or shows it as a suggestion.

const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 120 * 1000
const MAX_ACTIVITY = 200

function clampTimeout(value) {
  // null, '' and booleans are numbers to Number(): 0, a 1 s deadline. Only a real number counts.
  if (typeof value !== 'number') return MAX_TIMEOUT_MS
  const ms = value
  if (!Number.isFinite(ms)) return MAX_TIMEOUT_MS
  return Math.min(Math.max(ms, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

/**
 * `settings` is the validation agent as the single agent's settings (profiles.js validationAgentSettings), what the
 * validation and Settings › Agent read; `profiles` the file of agents behind it, for the Agents section's commands
 * (agent-commands.js).
 */
function createAgent({
  settings,
  profiles = null,
  key,
  logger,
  ask = providers.ask,
  now = Date.now,
}) {
  // The questions in flight: the validation's (stopped when the agent is paused or turned off) and the practice
  // test's (stopped by its own Stop button), apart so a settings change during a test does not cut it.
  const solving = new Set()
  const testing = new Set()
  const activity = []

  const log = (entry) => {
    activity.push({at: now(), ...entry})
    if (activity.length > MAX_ACTIVITY) activity.shift()
  }

  const stop = (set) => {
    set.forEach((controller) => controller.abort())
    set.clear()
  }

  // The agent answering the validation, named in its Activity lines.
  const validationId = () => {
    if (!profiles) return undefined
    const agent = validationAgent(profiles.read())
    return agent ? agent.id : undefined
  }

  const agents = profiles
    ? createAgentCommands({
        profiles,
        key,
        log,
        // The validation's question in flight ends when its agent is turned off, removed or paused.
        onChange: () => {
          const current = settings.read()
          if (current.paused || !current.enabled) stop(solving)
        },
      })
    : null

  const destination = ({provider, address}) => ({provider, address})

  // Whether an agent other than the validation agent has its service's key: then a kept key that is not the
  // validation agent's may be that agent's, and Settings › Agent leaves it alone.
  const othersHaveKeys = () => {
    if (!profiles) return false
    const id = validationId()
    return profiles
      .read()
      .agents.some((agent) => agent.id !== id && key.has(destination(agent)))
  }

  const status = () => {
    const current = settings.read()
    const hasKey = key.has(destination(current))
    return {
      settings: current,
      keychain: key.keychain(),
      hasKey,
      keyElsewhere: !hasKey && key.hasAny() && !othersHaveKeys(),
    }
  }

  /** One flip to the model, the answer read. Throws the provider's error. */
  const askFlip = async (config, flip, timeoutMs, running) => {
    const checked = checkFlip(flip)
    const {system, parts} = flipQuestion(checked)
    const controller = new AbortController()
    running.add(controller)
    try {
      const text = await ask(
        {
          provider: config.provider,
          address: config.address,
          model: config.model,
          key: key.read(destination(config)),
        },
        system,
        parts,
        {timeoutMs: clampTimeout(timeoutMs), signal: controller.signal}
      )
      return readFlipAnswer(text, {
        hasWords: checked.words.length > 0,
        thresholds: config.reportThresholds,
      })
    } finally {
      running.delete(controller)
    }
  }

  const solveFlip = async ({flip, reportsUsed = 0, timeoutMs} = {}) => {
    const config = settings.read()
    const agentId = validationId()
    const answerCheck = checkAction(config, 'answerFlip')
    if (answerCheck.decision === 'off') {
      log({
        agentId,
        action: 'answerFlip',
        decision: 'off',
        detail: answerCheck.reason,
      })
      return {decision: 'off', reason: answerCheck.reason}
    }
    let answer
    try {
      answer = await askFlip(config, flip, timeoutMs, solving)
    } catch (error) {
      log({
        agentId,
        action: 'answerFlip',
        decision: 'failed',
        detail: error.message,
      })
      throw error
    }
    const reportCheck = answer.report
      ? checkAction(config, 'report', {usage: reportsUsed})
      : {decision: 'off', reason: 'nothing to report'}
    const report = answer.report && reportCheck.decision !== 'off'
    // A report is never more automatic than the answer: with answers asked first, so is the report.
    const reportDecision =
      report && answerCheck.decision === 'ask' ? 'ask' : reportCheck.decision
    const result = {
      decision: answerCheck.decision,
      answer: answer.answer,
      confidence: answer.confidence,
      relevance:
        report || answer.relevance !== 'irrelevant' ? answer.relevance : null,
      report,
      reportDecision: report ? reportDecision : 'off',
    }
    log({
      agentId,
      action: 'answerFlip',
      decision: result.decision,
      detail: `${result.answer || 'skip'} ${result.confidence.toFixed(2)}${
        report ? ` report (${result.reportDecision})` : ''
      }`,
    })
    return result
  }

  const handlers = {
    ...(agents ? agents.commands : {}),
    status,
    saveSettings(data) {
      const saved = settings.write(data)
      if (saved.paused || !saved.enabled) stop(solving)
      log({
        agentId: validationId(),
        action: 'settings',
        decision: 'saved',
        detail: saved.provider,
      })
      return status()
    },
    setKey(data) {
      key.set(data && data.key, destination(settings.read()))
      log({
        agentId: validationId(),
        action: 'key',
        decision: 'saved',
        detail: '',
      })
      return status()
    },
    /**
     * Settings › Agent's Remove the key: the validation agent's service key; with none, the keys left from an older
     * setup (every key, when no other agent uses one). Another agent's key stays.
     */
    clearKey() {
      const current = destination(settings.read())
      if (key.has(current)) key.clear(current)
      else if (!othersHaveKeys()) key.clear()
      log({
        agentId: validationId(),
        action: 'key',
        decision: 'removed',
        detail: '',
      })
      return status()
    },
    solveFlip,
    /**
     * A try of the model on one flip, before the agent is on: no permission, the answer shown only. `agentId` names
     * the agent whose connection is tried (an agent's page); without it, the validation agent's (Settings › Agent).
     */
    async testFlip({flip, timeoutMs, agentId} = {}) {
      const config =
        agentId !== undefined && agents
          ? agents.config(agentId)
          : settings.read()
      const logged = agentId !== undefined ? agentId : validationId()
      try {
        const answer = await askFlip(config, flip, timeoutMs, testing)
        log({
          agentId: logged,
          action: 'test',
          decision: 'answered',
          detail: answer.answer || 'skip',
        })
        return answer
      } catch (error) {
        log({
          agentId: logged,
          action: 'test',
          decision: 'failed',
          detail: error.message,
        })
        throw error
      }
    },
    /** Leaving a validation: its question in flight ends at once. */
    stopSolve() {
      stop(solving)
      return null
    },
    /** The practice test's Stop: its question in flight ends at once. */
    stopTest() {
      stop(testing)
      return null
    },
    /** The log, newest first; with `agentId`, that agent's lines and the pause and resume of all agents. */
    activity: (data) => {
      const agentId = data && data.agentId
      const lines = activity.slice().reverse()
      return agentId === undefined
        ? lines
        : lines.filter(
            (entry) =>
              entry.agentId === agentId ||
              (entry.action === 'settings' &&
                ['paused', 'resumed'].includes(entry.decision))
          )
    },
  }

  return {
    commands: Object.keys(handlers),
    async handle(command, data) {
      if (!Object.prototype.hasOwnProperty.call(handlers, command))
        throw new Error('unknown agent command')
      try {
        return await handlers[command](data)
      } catch (error) {
        if (logger) logger.warn(`agent ${command} failed`, error.message)
        throw new Error(error.message)
      }
    },
    stop: () => {
      stop(solving)
      stop(testing)
    },
  }
}

module.exports = {createAgent, clampTimeout}
