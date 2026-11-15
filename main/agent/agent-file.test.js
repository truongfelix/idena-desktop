const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {agentFileName, exportAgent, readAgentFile} = require('./agent-file')

const JOKE = 'aaaaaaaaaaaaaaaa'
const joke = (more = {}) => ({
  id: JOKE,
  name: 'Joke agent',
  enabled: true,
  provider: 'anthropic',
  address: 'https://api.anthropic.com',
  model: 'claude-sonnet-5-5',
  instructions: 'Write one joke.',
  actions: {post: {level: 'alone', limit: 1}},
  schedule: {kind: 'daily', time: '09:00'},
  budgetPerDay: 0.05,
  task: 'joke',
  ...more,
})
const validation = {
  id: 'bbbbbbbbbbbbbbbb',
  name: 'Validation agent',
  enabled: true,
  actions: {answerFlip: {level: 'alone'}, report: {level: 'ask'}},
}

describe('an agent as a file', () => {
  const dirs = []
  // One desktop: its own folder of agents, a key kept for the Anthropic API.
  const desktop = (agents) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-file-'))
    dirs.push(dir)
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents,
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      pendingFile: () => path.join(dir, 'pending.json'),
      key: {
        keychain: () => ({available: true, reason: null}),
        has: (to) => to.provider === 'anthropic',
        hasAny: () => true,
        read: (to) => (to.provider === 'anthropic' ? 'sk-secret-key' : null),
        set: jest.fn(),
        clear: jest.fn(),
      },
      ask: jest.fn().mockResolvedValue('A joke.'),
      now: () => new Date(2026, 10, 15, 9, 0).getTime(),
    })
  }
  afterAll(() => dirs.forEach((dir) => fs.removeSync(dir)))

  test('the file holds the agent, never the key, the Activity or its id', async () => {
    const one = desktop([joke()])
    await one.handle('writeText', {agentId: JOKE, action: 'post', input: 'x'})
    const {fileName, text} = await one.handle('exportAgent', {agentId: JOKE})
    expect(fileName).toBe('joke-agent.idena-agent.json')
    expect(text).not.toContain('sk-secret-key')
    expect(text).not.toContain(JOKE)
    expect(JSON.parse(text)).toEqual({
      format: 'idena-agent',
      v: 1,
      name: 'Joke agent',
      instructions: 'Write one joke.',
      provider: 'anthropic',
      address: 'https://api.anthropic.com',
      model: 'claude-sonnet-5-5',
      actions: {post: {level: 'alone', limit: 1}},
      schedule: {kind: 'daily', time: '09:00'},
      budgetPerDay: 0.05,
      // A joke agent saved before it had reads: its tips, as it read them, no one's posts.
      reads: {
        posts: {window: 'off', count: 10},
        notifications: true,
        messages: false,
      },
      events: [],
      reportThresholds: expect.any(Object),
    })
  })

  test("an address that is not the service's default stays out (it may hold a secret)", () => {
    const text = exportAgent({
      ...joke(),
      provider: 'openai',
      address: 'https://user:token@llm.example/v1',
      reportThresholds: {},
    })
    expect(text).not.toContain('token')
    expect(readAgentFile(text).agent.address).toBe('https://api.openai.com/v1')
  })

  test('imported on another desktop: off, each action Off, what it asked for shown; on again it runs the same', async () => {
    const one = desktop([joke()])
    const {text} = await one.handle('exportAgent', {agentId: JOKE})
    const two = desktop([])
    const preview = await two.handle('previewAgent', {text})
    expect(preview).toMatchObject({
      agent: {
        name: 'Joke agent',
        enabled: false,
        actions: {post: {level: 'off', limit: 1}},
      },
      asked: {post: {level: 'alone', limit: 1}},
      dropped: [],
      hasKey: true,
    })
    const {savedId, agents} = await two.handle('importAgent', {text})
    expect(savedId).not.toBe(JOKE)
    const imported = agents[0]
    expect(imported).toMatchObject({enabled: false, name: 'Joke agent'})
    const post = (agent, id) =>
      agent.handle('propose', {
        agentId: id,
        action: 'post',
        body: 'j',
        usage: 0,
        amount: 1,
        cost: 0.01,
      })
    // Off until the person turns it on.
    await expect(post(two, savedId)).resolves.toMatchObject({decision: 'off'})
    const {hasKey, ...saved} = imported
    await two.handle('saveAgent', {
      ...saved,
      enabled: true,
      actions: {post: {level: 'alone', limit: 1}},
    })
    await expect(post(two, savedId)).resolves.toEqual(await post(one, JOKE))
    await expect(
      two.handle('writeText', {agentId: savedId, action: 'post', input: 'x'})
    ).resolves.toBe('A joke.')
  })

  test('the validation answers are not imported beside the agent that has them', async () => {
    const text = exportAgent({
      ...joke(),
      actions: {answerFlip: {level: 'alone'}, report: {level: 'ask'}},
      reportThresholds: {},
    })
    const busy = desktop([validation])
    const preview = await busy.handle('previewAgent', {text})
    expect(preview.dropped).toEqual(['answerFlip', 'report'])
    expect(preview.agent.actions).toEqual({})
    const free = desktop([])
    await expect(free.handle('previewAgent', {text})).resolves.toMatchObject({
      dropped: [],
      asked: {answerFlip: {level: 'alone'}},
    })
  })

  test("only the service's own address comes from a file: another is not taken, and the preview says so", async () => {
    const hostile = JSON.stringify({
      format: 'idena-agent',
      v: 1,
      name: 'Helper',
      provider: 'local',
      address: 'https://attacker.example/v1',
      model: 'm',
      actions: {post: {level: 'alone'}},
    })
    const one = desktop([])
    const preview = await one.handle('previewAgent', {text: hostile})
    expect(preview.agent.address).toBe('http://127.0.0.1:11434/v1')
    expect(preview.addressLeft).toBe(true)
    const {agents} = await one.handle('importAgent', {text: hostile})
    expect(agents[0].address).toBe('http://127.0.0.1:11434/v1')
    const {text} = await desktop([joke()]).handle('exportAgent', {
      agentId: JOKE,
    })
    await expect(one.handle('previewAgent', {text})).resolves.toMatchObject({
      addressLeft: false,
      agent: {address: 'https://api.anthropic.com'},
    })
  })

  test('a file that is no agent file is refused', async () => {
    const one = desktop([])
    // eslint-disable-next-line no-await-in-loop
    for (const text of [
      '',
      'not json',
      '{"format":"other","v":1}',
      '{"format":"idena-agent","v":2}',
      `{"format":"idena-agent","v":1,"instructions":"${'x'.repeat(200001)}"}`,
    ])
      await expect(one.handle('importAgent', {text})).rejects.toThrow(
        'not an agent file'
      )
    await expect(one.handle('agents')).resolves.toMatchObject({agents: []})
  })

  test('a file name in plain letters', () => {
    expect(agentFileName({name: '3615 IDENA: jokes!'})).toBe(
      '3615-idena-jokes.idena-agent.json'
    )
    expect(agentFileName({name: 'Équipe été'})).toBe(
      'equipe-ete.idena-agent.json'
    )
    expect(agentFileName({name: 'Шутки'})).toBe('agent.idena-agent.json')
    // Cut at 40 characters on a separator: no dash left at the end.
    expect(agentFileName({name: `${'a'.repeat(39)} b`})).toBe(
      `${'a'.repeat(39)}.idena-agent.json`
    )
  })
})
