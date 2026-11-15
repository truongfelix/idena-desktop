const {checkAction} = require('./permissions')
const {createAgentCommands} = require('./agent-commands')
const {createPending} = require('./pending')
const {createReadPoints} = require('./read-points')
const {agentSettings, reportAgent, validationAgent} = require('./profiles')
const {checkFlip, flipQuestion, mediaType, readFlipAnswer} = require('./flips')
const {readStory, storySystem} = require('./stories')
const {socialHeld, socialSystem} = require('./social')
const providers = require('./providers')

// The agent part of the main process: the renderer's one way to the agent (the "agent" channel). It keeps the
// settings and the key, checks each action before the model is asked, asks it, and logs what it did. The renderer
// then applies an answer the check allowed with the user's own code (a click), or shows it as a suggestion.

const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 120 * 1000
const MAX_ACTIVITY = 200
/** What an agent is given to read for a text (the joke agent: its recent jokes), and what its answer may be. */
const MAX_INPUT_TEXT = 20000
const MAX_ANSWER_TEXT = 4000
// A run's plan on Idena Social: several actions, each with a text of a post's length.
const MAX_PLAN_TEXT = 12000
const PLAN_MAX_TOKENS = 4096
// A story and four prompts of up to 120 words: about 1,500 tokens; room for a longer one.
const STORY_MAX_TOKENS = 4096

function clampTimeout(value) {
  // null, '' and booleans are numbers to Number(): 0, a 1 s deadline. Only a real number counts.
  if (typeof value !== 'number') return MAX_TIMEOUT_MS
  const ms = value
  if (!Number.isFinite(ms)) return MAX_TIMEOUT_MS
  return Math.min(Math.max(ms, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

/**
 * `settings` is the validation agent as the single agent's settings (profiles.js validationAgentSettings), what the
 * validation reads; `profiles` the file of agents behind it, for the Agents section's commands
 * (agent-commands.js).
 */
function createAgent({
  settings,
  profiles = null,
  pendingFile = null,
  readPointsFile = null,
  key,
  logger,
  notify = () => {},
  ask = providers.ask,
  draw = providers.drawImage,
  now = Date.now,
}) {
  // The questions in flight: the validation's (stopped when the agent is paused or turned off) and the practice
  // test's (stopped by its own Stop button), apart so a settings change during a test does not cut it.
  const solving = new Set()
  const testing = new Set()
  // The texts asked of the agents' models (the joke): stopped by the pause of all agents, not by a change of the
  // validation agent.
  const writing = new Set()
  const activity = []
  // When each agent's log was last cleared (B-252): the lines of all agents (pause, resume) older than it are hidden
  // on that agent's page too.
  const clearedAt = new Map()

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

  // To approve: the actions the agents prepared with Ask me (pending.js); the window hears each change.
  const pending = profiles
    ? createPending({
        profiles,
        log,
        file: pendingFile,
        logger,
        notify: () => notify('pending'),
        now,
      })
    : null

  // How far each agent read Idena Social (read-points.js).
  const readPoints = profiles
    ? createReadPoints({file: readPointsFile, logger})
    : null

  const agents = profiles
    ? createAgentCommands({
        profiles,
        key,
        log,
        // The validation's question in flight ends when its agent is turned off, removed or paused; an action
        // waiting for an agent removed, or an action turned Off, leaves To approve.
        onChange: (file) => {
          const current = settings.read()
          if (current.paused || !current.enabled) stop(solving)
          if (file.paused) stop(writing)
          pending.prune()
          readPoints.keepOnly(file.agents.map((agent) => agent.id))
        },
      })
    : null

  const destination = ({provider, address}) => ({provider, address})

  // Whether an agent other than the validation agent has its service's key: then a kept key that is not the
  // validation agent's may be that agent's, and the validation agent's Remove the key leaves it alone.
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

  // The Instructions of the agent `agentId` (the validation agent's without one), sent with each of its flips too.
  const instructionsOf = (agentId) => {
    if (!profiles) return ''
    const file = profiles.read()
    const agent =
      agentId !== undefined
        ? file.agents.find((one) => one.id === agentId)
        : validationAgent(file)
    return agent ? agent.instructions : ''
  }

  /** One flip to the model, the answer read. Throws the provider's error. */
  const askFlip = async (config, flip, timeoutMs, running, instructions) => {
    const checked = checkFlip(flip)
    const {system, parts} = flipQuestion(checked, instructions)
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

  /**
   * The agents of the validation (B-257): the one answering and the one reporting, each with its settings and
   * Instructions; the same object when one agent does both. Without the file of agents (the single agent's
   * settings), that one agent.
   */
  const validationAgents = () => {
    if (!profiles) {
      const one = {
        id: undefined,
        config: settings.read(),
        instructions: instructionsOf(undefined),
      }
      return {answering: one, reporting: one}
    }
    const file = profiles.read()
    const view = (agent) =>
      agent && {
        id: agent.id,
        config: agentSettings(file, agent),
        instructions: agent.instructions,
      }
    const answerer = validationAgent(file)
    const reporter = reportAgent(file)
    const answering = view(answerer)
    const reporting =
      reporter && answerer && reporter.id === answerer.id
        ? answering
        : view(reporter)
    return {answering, reporting}
  }

  /**
   * A flip of the validation: the answering agent's answer and, from the reporting agent (the same one, or another
   * asked apart once the flip has its keywords), the report and the keywords' mark. `decision` is what may be done
   * with the answer (`answers`: whether there is one to give), `markDecision` with the keywords' mark,
   * `reportDecision` with the report.
   */
  const solveFlip = async ({flip, reportsUsed = 0, timeoutMs} = {}) => {
    const {answering, reporting} = validationAgents()
    const answerCheck = answering
      ? checkAction(answering.config, 'answerFlip')
      : {decision: 'off', reason: 'no agent answers'}
    const reportAllowed = reporting
      ? checkAction(reporting.config, 'report', {usage: reportsUsed})
      : {decision: 'off', reason: 'no agent reports'}
    if (answerCheck.decision === 'off' && reportAllowed.decision === 'off') {
      log({
        agentId: answering ? answering.id : validationId(),
        action: 'answerFlip',
        decision: 'off',
        detail: answerCheck.reason,
      })
      return {decision: 'off', reason: answerCheck.reason}
    }
    const separate = Boolean(reporting) && reporting !== answering
    const hasWords = Boolean(flip && flip.words && flip.words.length)
    let answer = null
    if (answerCheck.decision !== 'off')
      try {
        answer = await askFlip(
          answering.config,
          flip,
          timeoutMs,
          solving,
          answering.instructions
        )
      } catch (error) {
        log({
          agentId: answering.id,
          action: 'answerFlip',
          decision: 'failed',
          detail: error.message,
        })
        throw error
      }
    // What the report is read from: the same answer, or the reporting agent's own question (another agent, or the
    // same one that does not answer).
    let reading = separate ? null : answer
    if (!reading && reportAllowed.decision !== 'off' && hasWords)
      try {
        reading = await askFlip(
          reporting.config,
          flip,
          timeoutMs,
          solving,
          reporting.instructions
        )
      } catch (error) {
        log({
          agentId: reporting.id,
          action: 'report',
          decision: 'failed',
          detail: error.message,
        })
        if (!answer) throw error
      }
    const reportCheck =
      reading && reading.report
        ? reportAllowed
        : {decision: 'off', reason: 'nothing to report'}
    const report =
      Boolean(reading && reading.report) && reportCheck.decision !== 'off'
    // One agent: a report is never more automatic than its answer (asked first, so is the report).
    const reportDecision =
      report && !separate && answerCheck.decision === 'ask'
        ? 'ask'
        : reportCheck.decision
    const shown = answer || reading
    const relevanceOf = (read) =>
      read && (report || read.relevance !== 'irrelevant')
        ? read.relevance
        : null
    // The keywords' marks are the reporting agent's when it is another; else the answering agent's, as before.
    let markDecision = reportAllowed.decision
    if (!separate && answerCheck.decision !== 'off')
      markDecision = answerCheck.decision
    const result = {
      decision: answer ? answerCheck.decision : reportAllowed.decision,
      answers: Boolean(answer),
      answer: shown ? shown.answer : null,
      confidence: shown ? shown.confidence : 0,
      relevance: relevanceOf(reading || answer),
      report,
      reportDecision: report ? reportDecision : 'off',
      markDecision,
    }
    if (answer)
      log({
        agentId: answering.id,
        action: 'answerFlip',
        decision: result.decision,
        detail: `${result.answer || 'skip'} ${answer.confidence.toFixed(2)}${
          report && !separate ? ` report (${result.reportDecision})` : ''
        }`,
      })
    if (reading && reading !== answer)
      log({
        agentId: reporting.id,
        action: 'report',
        decision: report ? result.reportDecision : reportAllowed.decision,
        detail: report ? 'report' : 'no report',
      })
    return result
  }

  const handlers = {
    ...(agents ? agents.commands : {}),
    ...(pending ? pending.commands : {}),
    ...(readPoints ? readPoints.commands : {}),
    /** An action an agent prepared (pending.js propose): refused, to do alone, or waiting in To approve. */
    ...(pending ? {propose: (data) => pending.propose(data)} : {}),
    status,
    saveSettings(data) {
      const saved = settings.write(data)
      if (saved.paused || !saved.enabled) stop(solving)
      if (saved.paused) stop(writing)
      if (pending) pending.prune()
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
     * The validation agent's Remove the key (clearKey, as Settings › Agent called it): its service key; with none, the keys left from an older
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
     * A text from the agent's model, for an action it may do (not Off, not paused): its instructions as the system
     * prompt, `input` (what the app gives it to read) as the question. The answer is a draft: the action itself still
     * goes through propose (To approve, or alone within its limits).
     */
    async writeText({agentId, action, input, timeoutMs} = {}) {
      if (!profiles) throw new Error('no agents')
      const file = profiles.read()
      const agent = file.agents.find((one) => one.id === agentId)
      if (!agent) throw new Error('no such agent')
      const check = checkAction(agentSettings(file, agent), action)
      if (check.decision === 'off') {
        log({agentId, action, decision: 'off', detail: check.reason})
        throw new Error(`the agent may not do it (${check.reason})`)
      }
      if (!agent.instructions.trim())
        throw new Error('the agent has no instructions')
      const controller = new AbortController()
      writing.add(controller)
      try {
        const answer = await ask(
          {
            provider: agent.provider,
            address: agent.address,
            model: agent.model,
            key: key.read(destination(agent)),
          },
          agent.instructions,
          [
            {
              type: 'text',
              text: String(input || '').slice(0, MAX_INPUT_TEXT),
            },
          ],
          {timeoutMs: clampTimeout(timeoutMs), signal: controller.signal}
        )
        return String(answer || '').slice(0, MAX_ANSWER_TEXT)
      } catch (error) {
        log({agentId, action, decision: 'failed', detail: error.message})
        throw error
      } finally {
        writing.delete(controller)
      }
    },
    /**
     * A run of the agent `agentId` on Idena Social (B-239): `input` is what the app gives it to read (the posts, replies
     * and messages since its last run, labelled); the system text is the app's frame with its Instructions and the
     * Social actions it holds (not Off). Returns the model's answer, a plan the app reads and checks action by action
     * (each one then goes through propose).
     */
    async planSocial({agentId, input, timeoutMs} = {}) {
      if (!profiles) throw new Error('no agents')
      const file = profiles.read()
      const agent = file.agents.find((one) => one.id === agentId)
      if (!agent) throw new Error('no such agent')
      const config = agentSettings(file, agent)
      const held = socialHeld(
        Object.keys(agent.actions).filter(
          (name) => checkAction(config, name).decision !== 'off'
        )
      )
      if (!held.length) {
        const {reason} = checkAction(config, 'reply')
        log({agentId, action: 'social', decision: 'off', detail: reason})
        throw new Error(`the agent may not do it (${reason})`)
      }
      const controller = new AbortController()
      writing.add(controller)
      try {
        const answer = await ask(
          {
            provider: agent.provider,
            address: agent.address,
            model: agent.model,
            key: key.read(destination(agent)),
          },
          socialSystem(held, agent.instructions),
          [
            {
              type: 'text',
              text: String(input || '').slice(0, MAX_INPUT_TEXT),
            },
          ],
          {
            timeoutMs: clampTimeout(timeoutMs),
            signal: controller.signal,
            maxTokens: PLAN_MAX_TOKENS,
          }
        )
        return {held, answer: String(answer || '').slice(0, MAX_PLAN_TEXT)}
      } catch (error) {
        log({
          agentId,
          action: 'social',
          decision: 'failed',
          detail: error.message,
        })
        throw error
      } finally {
        writing.delete(controller)
      }
    },
    /**
     * A flip's story (B-236): for the agent `agentId` holding "Write flip stories" (not Off), one story of `panels`
     * (3 or 4) panels for the flip's two keywords `words`, and one image prompt per panel, read from its answer. Nothing
     * goes to the chain: the person copies the prompts, or the images come into the flip editor for them to check.
     */
    async writeStory({agentId, panels, words, timeoutMs} = {}) {
      if (!profiles) throw new Error('no agents')
      const file = profiles.read()
      const agent = file.agents.find((one) => one.id === agentId)
      if (!agent) throw new Error('no such agent')
      const check = checkAction(agentSettings(file, agent), 'flipStory')
      if (check.decision === 'off') {
        log({
          agentId,
          action: 'flipStory',
          decision: 'off',
          detail: check.reason,
        })
        throw new Error(`the agent may not do it (${check.reason})`)
      }
      const system = storySystem(panels, words, agent.instructions)
      const controller = new AbortController()
      writing.add(controller)
      try {
        const answer = await ask(
          {
            provider: agent.provider,
            address: agent.address,
            model: agent.model,
            key: key.read(destination(agent)),
          },
          system,
          [{type: 'text', text: 'Write the story and its prompts now.'}],
          {
            timeoutMs: clampTimeout(timeoutMs),
            signal: controller.signal,
            maxTokens: STORY_MAX_TOKENS,
          }
        )
        const story = readStory(answer, panels)
        log({
          agentId,
          action: 'flipStory',
          decision: check.decision,
          detail: story.title,
        })
        return story
      } catch (error) {
        log({
          agentId,
          action: 'flipStory',
          decision: 'failed',
          detail: error.message,
        })
        throw error
      } finally {
        writing.delete(controller)
      }
    },
    /**
     * One picture of a flip's story (B-236 Make the images), drawn by the image model of the agent `agentId`, which
     * must hold "Write flip stories" (not Off): {mediaType, data}. It goes into the flip editor for the person to check.
     */
    async drawStoryPicture({agentId, prompt, timeoutMs} = {}) {
      if (!profiles) throw new Error('no agents')
      const file = profiles.read()
      const agent = file.agents.find((one) => one.id === agentId)
      if (!agent) throw new Error('no such agent')
      const check = checkAction(agentSettings(file, agent), 'flipStory')
      if (check.decision === 'off') {
        log({
          agentId,
          action: 'flipImage',
          decision: 'off',
          detail: check.reason,
        })
        throw new Error(`the agent may not do it (${check.reason})`)
      }
      if (typeof prompt !== 'string' || !prompt.trim())
        throw new Error('no prompt')
      const controller = new AbortController()
      writing.add(controller)
      try {
        const picture = await draw(
          {
            provider: agent.provider,
            address: agent.address,
            imageModel: agent.imageModel,
            key: key.read(destination(agent)),
          },
          prompt,
          {
            timeoutMs: clampTimeout(timeoutMs),
            signal: controller.signal,
            mediaTypeOf: mediaType,
          }
        )
        log({
          agentId,
          action: 'flipImage',
          decision: check.decision,
          detail: '',
        })
        return picture
      } catch (error) {
        log({
          agentId,
          action: 'flipImage',
          decision: 'failed',
          detail: error.message,
        })
        throw error
      } finally {
        writing.delete(controller)
      }
    },
    /**
     * A try of the model on one flip, before the agent is on: no permission, the answer shown only. `agentId` names
     * the agent whose connection is tried (an agent's page); without it, the validation agent's.
     */
    async testFlip({flip, timeoutMs, agentId} = {}) {
      const config =
        agentId !== undefined && agents
          ? agents.config(agentId)
          : settings.read()
      const logged = agentId !== undefined ? agentId : validationId()
      try {
        const answer = await askFlip(
          config,
          flip,
          timeoutMs,
          testing,
          instructionsOf(agentId)
        )
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
      // No agent named (no data, or none in it): every line.
      const agentId = data ? data.agentId : undefined
      const lines = activity.slice().reverse()
      if (agentId === undefined || agentId === null) return lines
      const since = clearedAt.get(agentId)
      return lines.filter(
        (entry) =>
          entry.agentId === agentId ||
          (entry.action === 'settings' &&
            ['paused', 'resumed'].includes(entry.decision) &&
            (since === undefined || entry.at > since))
      )
    },
    /** Clear: the agent's lines go (B-252); the other agents' stay. */
    clearActivity: (data) => {
      const agentId = data ? data.agentId : undefined
      if (typeof agentId !== 'string') throw new Error('no agent named')
      for (let i = activity.length - 1; i >= 0; i -= 1)
        if (activity[i].agentId === agentId) activity.splice(i, 1)
      clearedAt.set(agentId, now())
      return null
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
      stop(writing)
    },
    /** The window loaded (again): an approved action it was doing is no longer being done (pending.js). */
    windowLoaded: () => {
      if (pending) pending.interrupted()
    },
  }
}

module.exports = {createAgent, clampTimeout}
