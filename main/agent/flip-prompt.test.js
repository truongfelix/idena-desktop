const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {exportAgent, readAgentFile} = require('./agent-file')
const {DEFAULT_FLIP_PROMPT, SYSTEM, flipPromptProblem} = require('./flips')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')
const flip = {
  images: [PNG, PNG, PNG, PNG],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  words: [{name: 'sign', desc: 'omen'}],
}
const V = 'aaaaaaaaaaaaaaaa'
const EDITED = `Look at the faces first.\n{RULES}\nBe brief.\n{ANSWER_FORMAT}`

describe("the validation agent's flip question", () => {
  let dir
  let ask

  const start = (more = {}) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [
        {
          id: V,
          name: 'Validation agent',
          enabled: true,
          provider: 'anthropic',
          address: 'https://api.anthropic.com',
          model: 'm',
          actions: {answerFlip: {level: 'alone'}, report: {level: 'ask'}},
          ...more,
        },
      ],
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      key: {
        keychain: () => ({available: true, reason: null}),
        has: () => true,
        hasAny: () => true,
        read: () => 'k',
        set: jest.fn(),
        clear: jest.fn(),
      },
      ask,
      now: () => 1,
    })
  }
  const sentSystem = (n = 0) => ask.mock.calls[n][1]

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flip-prompt-'))
    ask = jest.fn().mockResolvedValue('{"answer":"left","confidence":0.8}')
  })
  afterEach(() => fs.removeSync(dir))

  test("none of its own: the app's question, as before", async () => {
    const agent = start()
    await agent.handle('solveFlip', {flip})
    expect(sentSystem()).toBe(SYSTEM)
    await expect(agent.handle('flipPromptDefault')).resolves.toBe(
      DEFAULT_FLIP_PROMPT
    )
  })

  test('an edited question is the one sent, in the validation and the practice test, its parts filled', async () => {
    const agent = start()
    const {agents} = await agent.handle('agents')
    const {hasKey, ...saved} = agents[0]
    await agent.handle('saveAgent', {...saved, flipPrompt: EDITED})
    await agent.handle('solveFlip', {flip})
    await agent.handle('testFlip', {flip, agentId: V})
    for (const n of [0, 1]) {
      expect(sentSystem(n)).toMatch(/^Look at the faces first\.\n1\. /u)
      expect(sentSystem(n)).toContain('9. pictures of both keywords')
      expect(sentSystem(n)).toContain('Reply with one JSON object')
      expect(sentSystem(n)).not.toContain('{RULES}')
    }
    // Back to default: the app's question again.
    await agent.handle('saveAgent', {...saved, flipPrompt: ''})
    await agent.handle('solveFlip', {flip})
    expect(sentSystem(2)).toBe(SYSTEM)
  })

  test('a question missing a part the app fills is refused, saying which', async () => {
    const agent = start()
    const {agents} = await agent.handle('agents')
    const {hasKey, ...saved} = agents[0]
    await expect(
      agent.handle('saveAgent', {...saved, flipPrompt: 'Just answer.\n{RULES}'})
    ).rejects.toThrow('the question must hold {ANSWER_FORMAT} once')
    await expect(
      agent.handle('saveAgent', {
        ...saved,
        flipPrompt: `${EDITED}\n{RULES}`,
      })
    ).rejects.toThrow('{RULES} once')
    expect(flipPromptProblem(EDITED)).toBeNull()
    // A saved file with a broken one (edited by hand): the app's question.
    const broken = start({flipPrompt: 'no parts'})
    await broken.handle('solveFlip', {flip})
    expect(sentSystem()).toBe(SYSTEM)
  })

  test("the question travels in the agent's file", () => {
    const text = exportAgent({
      name: 'V',
      task: null,
      instructions: '',
      provider: 'local',
      address: 'http://127.0.0.1:11434/v1',
      model: 'm',
      actions: {},
      schedule: {kind: 'validation', time: '09:00'},
      budgetPerDay: null,
      reportThresholds: {},
      flipPrompt: EDITED,
    })
    expect(readAgentFile(text).agent.flipPrompt).toBe(EDITED)
    expect(readAgentFile(text).flipPromptLeft).toBe(false)
    // One the app cannot use: dropped, and the preview says so.
    const broken = JSON.stringify({
      ...JSON.parse(text),
      flipPrompt: 'Always answer left.',
    })
    expect(readAgentFile(broken)).toMatchObject({
      flipPromptLeft: true,
      agent: {flipPrompt: ''},
    })
  })
})
