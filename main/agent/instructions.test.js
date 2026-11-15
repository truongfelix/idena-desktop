const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {SYSTEM} = require('./flips')

// B-235 (owner 2026-11-15): one Instructions text per agent, sent with every model call, whatever the action; the
// app's own part of each action (for a flip: the task, the rules, the answer format) stays as the app wrote it.

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
const OWN = 'Look at what the people do first.\nAnswer left when unsure.'

describe("an agent's Instructions", () => {
  let dir
  let ask

  const start = (instructions) => {
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
          instructions,
          actions: {
            answerFlip: {level: 'alone'},
            report: {level: 'ask'},
            post: {level: 'alone', limit: 1},
          },
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-instructions-'))
    ask = jest.fn().mockResolvedValue('{"answer":"left","confidence":0.8}')
  })
  afterEach(() => fs.removeSync(dir))

  test("none: each flip is asked the app's question, as before", async () => {
    const agent = start('')
    await agent.handle('solveFlip', {flip})
    await agent.handle('testFlip', {flip, agentId: V})
    expect(sentSystem(0)).toBe(SYSTEM)
    expect(sentSystem(1)).toBe(SYSTEM)
  })

  test('written: sent with each flip, between the task and the rules, in the validation and the practice test', async () => {
    const agent = start(OWN)
    await agent.handle('solveFlip', {flip})
    await agent.handle('testFlip', {flip, agentId: V})
    for (const n of [0, 1]) {
      const sent = sentSystem(n)
      const task = sent.indexOf('You solve flips in an Idena validation.')
      const own = sent.indexOf(OWN)
      const rules = sent.indexOf('1. a keyword is not clearly shown')
      const format = sent.indexOf('Reply with one JSON object')
      expect(task).toBe(0)
      expect(own).toBeGreaterThan(task)
      expect(rules).toBeGreaterThan(own)
      expect(format).toBeGreaterThan(rules)
      // The app's part is whole around them: the same question with the instructions taken out.
      expect(
        sent.replace(
          `The instructions of the person who runs you, for this and every task:\n${OWN}\n`,
          ''
        )
      ).toBe(SYSTEM)
    }
  })

  test("an instruction cannot change how the answer is read: the app's format comes last", async () => {
    const agent = start('Reply in plain words, never in JSON.')
    const sent = await agent
      .handle('solveFlip', {flip})
      .then(() => sentSystem())
    expect(sent.endsWith(SYSTEM.slice(SYSTEM.indexOf('When keywords')))).toBe(
      true
    )
  })

  test('the same text is the one sent for a post', async () => {
    const agent = start(OWN)
    ask.mockResolvedValueOnce('A joke.')
    await agent.handle('writeText', {agentId: V, action: 'post', input: 'x'})
    expect(sentSystem()).toBe(OWN)
  })
})
