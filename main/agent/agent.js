const {checkAction} = require('./permissions')
const {checkFlip, flipQuestion, readFlipAnswer} = require('./flips')
const providers = require('./providers')

// The agent part of the main process: the renderer's one way to the agent (the "agent" channel). It keeps the
// settings and the key, checks each action before the model is asked, asks it, and logs what it did. The renderer
// then applies an answer the check allowed with the user's own code (a click), or shows it as a suggestion.

const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 120 * 1000
const MAX_ACTIVITY = 200

function clampTimeout(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms)) return MAX_TIMEOUT_MS
  return Math.min(Math.max(ms, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

function createAgent({
  settings,
  key,
  logger,
  ask = providers.ask,
  now = Date.now,
}) {
  const running = new Set()
  const activity = []

  const log = (entry) => {
    activity.push({at: now(), ...entry})
    if (activity.length > MAX_ACTIVITY) activity.shift()
  }

  const status = () => ({
    settings: settings.read(),
    keychain: key.keychain(),
    hasKey: key.has(),
  })

  const stopRunning = () => {
    running.forEach((controller) => controller.abort())
    running.clear()
  }

  /** One flip to the model, the answer read. Throws the provider's error. */
  const askFlip = async (config, flip, timeoutMs) => {
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
          key: key.read(),
        },
        system,
        parts,
        {timeoutMs: clampTimeout(timeoutMs), signal: controller.signal}
      )
      return readFlipAnswer(text, {hasWords: checked.words.length > 0})
    } finally {
      running.delete(controller)
    }
  }

  const solveFlip = async ({flip, reportsUsed = 0, timeoutMs} = {}) => {
    const config = settings.read()
    const answerCheck = checkAction(config, 'answerFlip')
    if (answerCheck.decision === 'off') {
      log({action: 'answerFlip', decision: 'off', detail: answerCheck.reason})
      return {decision: 'off', reason: answerCheck.reason}
    }
    let answer
    try {
      answer = await askFlip(config, flip, timeoutMs)
    } catch (error) {
      log({action: 'answerFlip', decision: 'failed', detail: error.message})
      throw error
    }
    const reportCheck = answer.report
      ? checkAction(config, 'report', {usage: reportsUsed})
      : {decision: 'off', reason: 'nothing to report'}
    const report = answer.report && reportCheck.decision !== 'off'
    const result = {
      decision: answerCheck.decision,
      answer: answer.answer,
      confidence: answer.confidence,
      relevance:
        report || answer.relevance !== 'irrelevant' ? answer.relevance : null,
      report,
      reportDecision: report ? reportCheck.decision : 'off',
    }
    log({
      action: 'answerFlip',
      decision: result.decision,
      detail: `${result.answer || 'skip'} ${result.confidence.toFixed(2)}${
        report ? ` report (${result.reportDecision})` : ''
      }`,
    })
    return result
  }

  const handlers = {
    status,
    saveSettings(data) {
      const saved = settings.write(data)
      if (saved.paused || !saved.enabled) stopRunning()
      log({action: 'settings', decision: 'saved', detail: saved.provider})
      return status()
    },
    setKey(data) {
      key.set(data && data.key)
      log({action: 'key', decision: 'saved', detail: ''})
      return status()
    },
    clearKey() {
      key.clear()
      log({action: 'key', decision: 'removed', detail: ''})
      return status()
    },
    solveFlip,
    /** A try of the model on one flip from Settings, before the agent is on: no permission, the answer shown only. */
    async testFlip({flip, timeoutMs} = {}) {
      const config = settings.read()
      try {
        const answer = await askFlip(config, flip, timeoutMs)
        log({
          action: 'test',
          decision: 'answered',
          detail: answer.answer || 'skip',
        })
        return answer
      } catch (error) {
        log({action: 'test', decision: 'failed', detail: error.message})
        throw error
      }
    },
    activity: () => activity.slice().reverse(),
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
    stop: stopRunning,
  }
}

module.exports = {createAgent, clampTimeout}
