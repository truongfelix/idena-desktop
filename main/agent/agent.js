const {checkAction} = require('./permissions')
const {createAgentCommands} = require('./agent-commands')
const {createPending} = require('./pending')
const {createReadPoints} = require('./read-points')
const {agentSettings, reportAgent, validationAgent} = require('./profiles')
const {checkFlip, flipQuestion, mediaType, readFlipAnswer} = require('./flips')
const {readStories, storyQuestion, storySystem} = require('./stories')
const {appTexts} = require('./app-texts')
const {socialHeld, socialSystem} = require('./social')
const {
  internetLine,
  internetTools,
  noSearchReason,
  searchesLeft,
} = require('./internet')
const providers = require('./providers')

// The agent part of the main process: the renderer's one way to the agent (the "agent" channel). It keeps the
// settings and the key, checks each action before the model is asked, asks it, and logs what it did. The renderer
// then applies an answer the check allowed with the user's own code (a click), or shows it as a suggestion.

const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 120 * 1000
const MAX_ACTIVITY = 200
// What starts a Social run (B-274): its time of the day, its hour, an event it reads, or Run now.
const RUN_KINDS = ['daily', 'hourly', 'event', 'now']
/** What an agent is given to read for a text (the joke agent: its recent jokes), and what its answer may be. */
const MAX_INPUT_TEXT = 20000
const MAX_ANSWER_TEXT = 4000
// A run's plan on Idena Social: several actions, each with a text of a post's length.
const MAX_PLAN_TEXT = 12000
// The pictures of the posts a run reads (B-293, renderer/screens/agents/social/digest.js MAX_PICTURES), each one as
// the renderer drew it: JPEG (or another type the models read), base64, below the Anthropic API's 5 MB a picture.
const MAX_PICTURES = 20
const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_PICTURE_DATA = Math.floor((5 * 1024 * 1024 * 4) / 3)
const PICTURE_ID = /^img[0-9]{1,3}$/u

/**
 * The parts of a Social run's question (B-293): its text, then each picture after its name ("img1:"), when the agent
 * sends them. A picture that is not one the models read, too large or misnamed, is left out; its name then stays in
 * the text without a picture after it.
 */
function socialParts(agent, input, pictures) {
  const parts = [
    {type: 'text', text: String(input || '').slice(0, MAX_INPUT_TEXT)},
  ]
  if (agent.postPictures !== 'send' || !Array.isArray(pictures)) return parts
  const seen = new Set()
  pictures
    .filter(
      (one) =>
        one &&
        typeof one.id === 'string' &&
        PICTURE_ID.test(one.id) &&
        PICTURE_TYPES.includes(one.mediaType) &&
        typeof one.data === 'string' &&
        one.data.length > 0 &&
        one.data.length <= MAX_PICTURE_DATA &&
        /^[A-Za-z0-9+/]+={0,2}$/u.test(one.data)
    )
    .slice(0, MAX_PICTURES)
    .forEach((one) => {
      if (seen.has(one.id)) return
      seen.add(one.id)
      parts.push(
        {type: 'text', text: `${one.id}:`},
        {type: 'image', mediaType: one.mediaType, data: one.data}
      )
    })
  return parts
}
const PLAN_MAX_TOKENS = 4096
// Stories with 12 prompts of up to 120 words and each story in words (B-268): about 4,000 tokens; room for more.
const STORY_MAX_TOKENS = 8192
// A picture that failed before the service could draw it (B-269): the key refused, the service not reached, the
// request stopped or never built. A deadline may come after the service drew and billed it: it counts.
const NOT_BILLED =
  /HTTP 40[13]\b|cannot be reached|^stopped$|no key|no image model|draws no pictures/u

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
    ? createReadPoints({file: readPointsFile, logger, now})
    : null

  // The agents of the validation that are on (answering, reporting), by id: one that stops being so ends its question.
  const validationActive = (file) =>
    [validationAgent(file), reportAgent(file)]
      .filter((agent) => agent && agent.enabled)
      .map((agent) => agent.id)
  let lastActive = profiles ? validationActive(profiles.read()) : []

  const agents = profiles
    ? createAgentCommands({
        profiles,
        key,
        log,
        // The validation's question in flight ends when its agent is turned off, removed or paused; an action
        // waiting for an agent removed, or an action turned Off, leaves To approve.
        onChange: (file) => {
          // The pause, or an agent of the validation turned off or gone (B-257): its question ends. Not at an edit of
          // another agent while one of them stays off.
          const active = validationActive(file)
          if (file.paused || lastActive.some((id) => !active.includes(id)))
            stop(solving)
          lastActive = active
          if (file.paused) stop(writing)
          pending.prune()
          readPoints.keepOnly(file.agents.map((agent) => agent.id))
        },
      })
    : null

  const destination = ({provider, address}) => ({provider, address})
  /** What a question to the agent's model is sent with: its service, model, longest answer, effort and key. */
  const connection = (agent) => ({
    provider: agent.provider,
    address: agent.address,
    model: agent.model,
    maxTokens: agent.maxTokens,
    effort: agent.effort,
    key: key.read(destination(agent)),
  })

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
  // Its own texts (B-282 the validation's system text, B-285 the question's words), when it changed some, the same
  // way: the whole of its parts, which flipQuestion reads by name.
  const validationPartOf = (agentId) => {
    if (!profiles) return null
    const file = profiles.read()
    const agent =
      agentId !== undefined
        ? file.agents.find((one) => one.id === agentId)
        : validationAgent(file)
    return (agent && agent.appParts) || null
  }

  /** One flip to the model, the answer read. Throws the provider's error. */
  const askFlip = async (
    config,
    flip,
    timeoutMs,
    running,
    instructions,
    part = null
  ) => {
    const checked = checkFlip(flip)
    // `part`: the agent's own texts (B-282 the system text, B-285 the question's words), or null.
    const {system, parts} = flipQuestion(
      checked,
      instructions,
      (part && part.validation) || null,
      part
    )
    const controller = new AbortController()
    running.add(controller)
    try {
      const text = await ask(connection(config), system, parts, {
        timeoutMs: clampTimeout(timeoutMs),
        signal: controller.signal,
      })
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
        part: validationPartOf(undefined),
      }
      return {answering: one, reporting: one}
    }
    const file = profiles.read()
    const view = (agent) =>
      agent && {
        id: agent.id,
        // Its model's longest answer and effort (B-265), beside the settings the validation reads.
        config: {
          ...agentSettings(file, agent),
          maxTokens: agent.maxTokens,
          effort: agent.effort,
        },
        instructions: agent.instructions,
        part: agent.appParts || null,
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
   * asked at the same time once the flip has its keywords), the report and the keywords' mark. `decision` is what may
   * be done with the answer (`answers`: whether there is one to give), `markDecision` with the keywords' mark,
   * `reportDecision` with the report. `reportLater`: another agent reports, the flip has no keywords yet: ask again
   * with `reportOnly` once it has them. `answerError`: the answering model failed, the report may still be there.
   */
  const solveFlip = async ({
    flip,
    reportsUsed = 0,
    timeoutMs,
    reportOnly = false,
  } = {}) => {
    const {answering, reporting} = validationAgents()
    const answerCheck =
      answering && !reportOnly
        ? checkAction(answering.config, 'answerFlip')
        : {decision: 'off', reason: 'no agent answers'}
    const reportAllowed = reporting
      ? checkAction(reporting.config, 'report', {usage: reportsUsed})
      : {decision: 'off', reason: 'no agent reports'}
    if (answerCheck.decision === 'off' && reportAllowed.decision === 'off') {
      // The reason of the agent that would have acted: the answering one, else the reporting one.
      const byAnswer = Boolean(answering) && !reportOnly
      const reason = byAnswer ? answerCheck.reason : reportAllowed.reason
      log({
        agentId: byAnswer || !reporting ? validationId() : reporting.id,
        action: byAnswer || !reporting ? 'answerFlip' : 'report',
        decision: 'off',
        detail: reason,
      })
      return {decision: 'off', reason}
    }
    // Another agent that may report: asked apart. One that is off changes nothing for the answering agent.
    const separate =
      Boolean(reporting) &&
      reporting !== answering &&
      reportAllowed.decision !== 'off'
    const hasWords = Boolean(flip && flip.words && flip.words.length)
    const asksAnswer = answerCheck.decision !== 'off'
    // The same agent that does not answer reads its report from its own question too.
    const asksReport =
      reportAllowed.decision !== 'off' && hasWords && (separate || !asksAnswer)
    const asker = asksReport && separate ? reporting : answering || reporting
    // Both at once: a flip's time is shared, not doubled.
    const [answered, reported] = await Promise.allSettled([
      asksAnswer
        ? askFlip(
            answering.config,
            flip,
            timeoutMs,
            solving,
            answering.instructions,
            answering.part
          )
        : Promise.resolve(null),
      asksReport
        ? askFlip(
            asker.config,
            flip,
            timeoutMs,
            solving,
            asker.instructions,
            asker.part
          )
        : Promise.resolve(null),
    ])
    const answer = answered.status === 'fulfilled' ? answered.value : null
    if (answered.status === 'rejected')
      log({
        agentId: answering.id,
        action: 'answerFlip',
        decision: 'failed',
        detail: answered.reason.message,
      })
    if (reported.status === 'rejected')
      log({
        agentId: asker.id,
        action: 'report',
        decision: 'failed',
        detail: reported.reason.message,
      })
    const reportFailed = reported.status === 'rejected'
    // Nothing came back: the error, as before.
    if (answered.status === 'rejected' && (!asksReport || reportFailed))
      throw answered.reason
    if (!asksAnswer && reportFailed) throw reported.reason
    // What the report is read from: the same answer, or the reporting question.
    const reading = asksReport ? reported.value : !separate && answer
    const reportCheck =
      reading && reading.report
        ? reportAllowed
        : {decision: 'off', reason: 'nothing to report'}
    const report =
      Boolean(reading && reading.report) && reportCheck.decision !== 'off'
    // One agent: a report is never more automatic than its answer (asked first, so is the report).
    const reportDecision =
      report && !separate && asksAnswer && answerCheck.decision === 'ask'
        ? 'ask'
        : reportCheck.decision
    // The side shown: the answer's; a reporting agent's side only places its report, it is never an answer.
    const shown = answer || null
    const relevanceOf = (read) =>
      read && (report || read.relevance !== 'irrelevant')
        ? read.relevance
        : null
    // The keywords' marks: the reporting agent's when another reports (none when its question failed, or before the
    // keywords); else the answering agent's, as before.
    let markDecision = reportAllowed.decision
    if (separate) markDecision = reading ? reportAllowed.decision : 'off'
    else if (asksAnswer) markDecision = answerCheck.decision
    const result = {
      decision: answer ? answerCheck.decision : reportAllowed.decision,
      answers: Boolean(answer),
      answer: shown ? shown.answer : null,
      reportSide: reading ? reading.answer : null,
      confidence: (shown || reading || {confidence: 0}).confidence,
      relevance: relevanceOf(reading || (separate ? null : answer)),
      report,
      reportDecision: report ? reportDecision : 'off',
      // How sure the report is (its surest reason): Autopilot reports the surest first when it may not report all.
      reportConfidence: report ? reading.reportConfidence : 0,
      // How good a flip it is, from the agent that marks the keywords (B-260: the best flip).
      quality: (reading || (separate ? null : answer) || {}).quality ?? null,
      doubted: Boolean((reading || (separate ? null : answer) || {}).doubted),
      markDecision,
      reportLater: separate && !hasWords,
      ...(answered.status === 'rejected'
        ? {answerError: answered.reason.message}
        : {}),
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
    if (asksReport && reading)
      log({
        agentId: asker.id,
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
          connection(agent),
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
    async planSocial({agentId, input, pictures, why, timeoutMs} = {}) {
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
      // What started the run, before its question (B-274): every question billed is named in Activity.
      if (RUN_KINDS.includes(why)) log({agentId, action: 'run', decision: why})
      // Its internet (B-294): the searches left in this answer, within its searches a day; none, no tools.
      const today = pending.searchesToday(agentId)
      const searches = searchesLeft(agent, today)
      const noSearch = noSearchReason(agent, today)
      if (noSearch && noSearch !== 'off')
        log({agentId, action: 'webSearch', decision: 'off', detail: noSearch})
      const system = socialSystem(
        held,
        agent.instructions,
        (agent.appParts && agent.appParts.social) || null,
        (agent.appParts && agent.appParts.socialActions) || null
      )
      let searched = 0
      let opened = 0
      const controller = new AbortController()
      writing.add(controller)
      try {
        const answer = await ask(
          connection(agent),
          searches
            ? `${system}\n\n${internetLine(agent.internet, searches)}`
            : system,
          socialParts(agent, input, pictures),
          {
            timeoutMs: clampTimeout(timeoutMs),
            signal: controller.signal,
            maxTokens: PLAN_MAX_TOKENS,
            tools: internetTools(agent.internet, searches),
            // Counted as each request comes back: a failure after a search keeps it counted (it was billed).
            onSearches: (n) => {
              searched += n
              pending.addSearches(agentId, n)
            },
            onPages: (n) => {
              opened += n
            },
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
        // Its searches named in Activity, also when the run failed after them (each one was billed, B-274).
        // The pages it opened too (B-296), beside them.
        if (searched || opened)
          log({
            agentId,
            action: 'webSearch',
            decision: 'alone',
            detail: [
              searched &&
                `${searched} ${searched === 1 ? 'search' : 'searches'}`,
              opened && `${opened} ${opened === 1 ? 'page' : 'pages'} opened`,
            ]
              .filter(Boolean)
              .join(', '),
          })
        writing.delete(controller)
      }
    },
    /**
     * A flip's stories (B-236, B-268): for the agent `agentId` holding "Write flip stories" (not Off), the stories and
     * image prompts its Instructions ask for, for the flip's two keywords `words`, the person's `idea`, the `parts`
     * asked ('story', 'prompts') and the titles given before (`notThese`). Nothing goes to the chain: the person reads
     * the stories, edits the prompts, and the pictures come into the flip editor for them to choose.
     */
    async writeStory({agentId, words, idea, parts, notThese, timeoutMs} = {}) {
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
      const question = storyQuestion(
        {words, idea, parts, notThese},
        (agent.appParts && agent.appParts.storyQuestion) || null
      )
      const system = storySystem(
        agent.instructions,
        (agent.appParts && agent.appParts.flipStory) || null
      )
      const controller = new AbortController()
      writing.add(controller)
      try {
        const answer = await ask(
          connection(agent),
          system,
          [{type: 'text', text: question}],
          {
            timeoutMs: clampTimeout(timeoutMs),
            signal: controller.signal,
            maxTokens: STORY_MAX_TOKENS,
          }
        )
        const written = readStories(answer, parts)
        log({
          agentId,
          action: 'flipStory',
          decision: check.decision,
          detail: written.stories
            .map((one) => one.title)
            .filter(Boolean)
            .join(' · '),
        })
        return written
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
     * must hold "Make the pictures" (not Off, B-258): {mediaType, data}. It goes into the flip editor for the person to
     * check, or into an agent's draft (a Flips run).
     */
    async drawStoryPicture({agentId, prompt, timeoutMs} = {}) {
      if (!profiles) throw new Error('no agents')
      const file = profiles.read()
      const agent = file.agents.find((one) => one.id === agentId)
      if (!agent) throw new Error('no such agent')
      const check = checkAction(agentSettings(file, agent), 'flipPictures')
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
      // Its pictures a day (B-269): each one is billed by its service. Counted when asked, and kept with the day's
      // tally (pending.js): a restart keeps the count. A failure the service cannot have billed is given back.
      const limit = agent.actions.flipPictures.picturesPerDay
      const drawnToday = pending.picturesToday(agentId)
      if (typeof limit === 'number' && drawnToday + 1 > limit) {
        log({
          agentId,
          action: 'flipImage',
          decision: 'off',
          detail: 'pictures a day reached',
        })
        throw new Error(`its ${limit} pictures a day are reached`)
      }
      pending.addPicture(agentId)
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
            texts: agent.appParts || null,
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
        if (NOT_BILLED.test(error.message)) pending.addPicture(agentId, -1)
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
     * A draft judged as a validator would (B-258 Judge the flip): the validation's question on `flip` (its four
     * pictures, its two orders, its keywords) to the agent `agentId`, which must hold "Judge the flip" (not Off). The
     * answer as the validation reads it; the renderer makes it the draft's verdict.
     */
    async judgeFlip({agentId, flip, timeoutMs} = {}) {
      if (!profiles) throw new Error('no agents')
      const file = profiles.read()
      const agent = file.agents.find((one) => one.id === agentId)
      if (!agent) throw new Error('no such agent')
      const config = agentSettings(file, agent)
      const check = checkAction(config, 'flipJudge')
      if (check.decision === 'off') {
        log({
          agentId,
          action: 'flipJudge',
          decision: 'off',
          detail: check.reason,
        })
        throw new Error(`the agent may not do it (${check.reason})`)
      }
      try {
        return await askFlip(
          {...config, maxTokens: agent.maxTokens, effort: agent.effort},
          flip,
          timeoutMs,
          writing,
          agent.instructions,
          agent.appParts || null
        )
      } catch (error) {
        log({
          agentId,
          action: 'flipJudge',
          decision: 'failed',
          detail: error.message,
        })
        throw error
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
          instructionsOf(agentId),
          validationPartOf(agentId)
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
    // What the app adds to the Instructions per action, and the suggestions (B-268): the agent page's ⓘ.
    appTexts: (data) => appTexts(data),
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

module.exports = {createAgent, clampTimeout, socialParts}
