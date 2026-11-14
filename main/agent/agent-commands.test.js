const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {
  MAX_AGENTS,
  createAgentProfiles,
  validationAgentSettings,
} = require('./profiles')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')
const flip = {
  images: [PNG, PNG, PNG, PNG],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  words: [{name: 'sign', desc: 'omen'}],
}

const validation = {
  name: 'Validation agent',
  enabled: true,
  provider: 'anthropic',
  address: 'https://api.anthropic.com',
  model: 'claude-opus-5-5',
  actions: {answerFlip: {level: 'alone'}, report: {level: 'ask'}},
  schedule: {kind: 'validation'},
}

describe('the Agents section commands', () => {
  let dir
  let keys
  let key
  let ask

  const start = (agents = []) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents,
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
      singleFile: () => path.join(dir, 'settings.json'),
    })
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      key,
      ask,
      now: () => 1,
    })
  }

  const same = (a, b) => a.provider === b.provider && a.address === b.address

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-commands-'))
    keys = []
    key = {
      keychain: () => ({available: true, reason: null}),
      has: (to) => keys.some((entry) => same(entry, to)),
      hasAny: () => keys.length > 0,
      read: (to) => (keys.find((entry) => same(entry, to)) || {}).key || null,
      set: jest.fn((value, to) => {
        keys = [
          ...keys.filter((entry) => !same(entry, to)),
          {...to, key: value},
        ]
      }),
      // As key.js: no destination removes every key.
      clear: jest.fn((to) => {
        keys = to ? keys.filter((entry) => !same(entry, to)) : []
      }),
    }
    ask = jest.fn().mockResolvedValue('{"answer":"left","confidence":0.8}')
  })
  afterEach(() => fs.removeSync(dir))

  test('the list says which service has a key, never the key', async () => {
    const agent = start([{id: 'aaaaaaaaaaaaaaaa', ...validation}])
    keys = [
      {
        provider: 'anthropic',
        address: 'https://api.anthropic.com',
        key: 'sk-secret',
      },
    ]
    const list = await agent.handle('agents')
    expect(JSON.stringify(list)).not.toContain('sk-secret')
    expect(list.agents.map((a) => [a.name, a.hasKey])).toEqual([
      ['Validation agent', true],
    ])
  })

  test('a new agent gets an id, starts off with no action, and is added last', async () => {
    const agent = start([{id: 'aaaaaaaaaaaaaaaa', ...validation}])
    const saved = await agent.handle('saveAgent', {name: 'Joke agent'})
    expect(saved.savedId).toMatch(/^[0-9a-f]{16}$/u)
    expect(saved.savedId).not.toBe('aaaaaaaaaaaaaaaa')
    const added = saved.agents[1]
    expect(added).toMatchObject({
      id: saved.savedId,
      name: 'Joke agent',
      enabled: false,
      actions: {},
    })
  })

  test("an id sent for a new agent is not used: a new agent never takes another one's place", async () => {
    const agent = start([{id: 'aaaaaaaaaaaaaaaa', ...validation}])
    await expect(
      agent.handle('saveAgent', {id: 'bbbbbbbbbbbbbbbb', name: 'Late'})
    ).rejects.toThrow('no such agent')
    const {agents} = await agent.handle('agents')
    expect(agents.map((a) => a.name)).toEqual(['Validation agent'])
  })

  test('a save after the agent was removed does not bring it back', async () => {
    const agent = start([
      {id: 'aaaaaaaaaaaaaaaa', ...validation},
      {id: 'bbbbbbbbbbbbbbbb', name: 'Joke agent'},
    ])
    await agent.handle('removeAgent', {agentId: 'bbbbbbbbbbbbbbbb'})
    await expect(
      agent.handle('saveAgent', {id: 'bbbbbbbbbbbbbbbb', name: 'Joke agent'})
    ).rejects.toThrow('no such agent')
    const {agents} = await agent.handle('agents')
    expect(agents.map((a) => a.id)).toEqual(['aaaaaaaaaaaaaaaa'])
  })

  test('only one agent answers the validation: a second one is refused, by name', async () => {
    const agent = start([
      {id: 'aaaaaaaaaaaaaaaa', ...validation},
      {id: 'bbbbbbbbbbbbbbbb', name: 'Joke agent'},
    ])
    await expect(
      agent.handle('saveAgent', {
        id: 'bbbbbbbbbbbbbbbb',
        name: 'Joke agent',
        actions: {answerFlip: {level: 'ask'}},
      })
    ).rejects.toThrow('Validation agent already answers the validation')
    const {agents} = await agent.handle('agents')
    expect(agents[1].actions).toEqual({})
    // The holder itself saves with it.
    await agent.handle('saveAgent', {...agents[0], name: 'Validator'})
    const after = await agent.handle('agents')
    expect(after.agents[0]).toMatchObject({
      name: 'Validator',
      actions: {answerFlip: {level: 'alone'}},
    })
  })

  test('an action outside the catalog is not kept', async () => {
    const agent = start()
    const {agents} = await agent.handle('saveAgent', {
      name: 'X',
      actions: {constructor: {level: 'alone'}, readKey: {level: 'alone'}},
    })
    expect(agents[0].actions).toEqual({})
  })

  test(`at most ${MAX_AGENTS} agents`, async () => {
    const many = Array.from({length: MAX_AGENTS}, (_, i) => ({
      id: (i + 1).toString(16).padStart(16, '0'),
      name: `A${i}`,
    }))
    const agent = start(many)
    await expect(agent.handle('saveAgent', {name: 'One more'})).rejects.toThrow(
      `at most ${MAX_AGENTS}`
    )
  })

  test('a save turning the validation agent off ends its question in flight', async () => {
    const agent = start([{id: 'aaaaaaaaaaaaaaaa', ...validation}])
    let aborted = false
    ask.mockImplementation(
      (config, system, parts, {signal}) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
        })
    )
    const solving = agent.handle('solveFlip', {flip})
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    const {agents} = await agent.handle('agents')
    await agent.handle('saveAgent', {...agents[0], enabled: false})
    await expect(solving).rejects.toThrow('aborted')
    expect(aborted).toBe(true)
  })

  test('the pause holds for every agent and reaches the validation', async () => {
    const agent = start([{id: 'aaaaaaaaaaaaaaaa', ...validation}])
    const list = await agent.handle('setPaused', {paused: true})
    expect(list.paused).toBe(true)
    await expect(agent.handle('status')).resolves.toMatchObject({
      settings: {paused: true},
    })
    await expect(agent.handle('solveFlip', {flip})).resolves.toMatchObject({
      decision: 'off',
      reason: 'paused',
    })
    expect(ask).not.toHaveBeenCalled()
  })

  test("a key is kept for the agent's service and removed for that service only", async () => {
    const agent = start([
      {id: 'aaaaaaaaaaaaaaaa', ...validation},
      {
        id: 'bbbbbbbbbbbbbbbb',
        name: 'Other',
        provider: 'openai',
        address: 'https://x.test/v1',
      },
    ])
    await agent.handle('setAgentKey', {agentId: 'bbbbbbbbbbbbbbbb', key: 'k1'})
    await agent.handle('setAgentKey', {agentId: 'aaaaaaaaaaaaaaaa', key: 'k2'})
    expect(key.set).toHaveBeenCalledWith('k1', {
      provider: 'openai',
      address: 'https://x.test/v1',
    })
    const list = await agent.handle('clearAgentKey', {
      agentId: 'bbbbbbbbbbbbbbbb',
    })
    expect(list.agents.map((a) => a.hasKey)).toEqual([true, false])
    await expect(
      agent.handle('setAgentKey', {agentId: 'cccccccccccccccc', key: 'k3'})
    ).rejects.toThrow('no such agent')
  })

  test("Settings › Agent's Remove the key leaves another agent's key", async () => {
    const agent = start([
      {id: 'aaaaaaaaaaaaaaaa', ...validation},
      {
        id: 'bbbbbbbbbbbbbbbb',
        name: 'Other',
        provider: 'openai',
        address: 'https://x.test/v1',
      },
    ])
    keys = [
      {provider: 'anthropic', address: 'https://api.anthropic.com', key: 'k1'},
      {provider: 'openai', address: 'https://x.test/v1', key: 'k2'},
    ]
    await agent.handle('clearKey')
    expect(keys.map((entry) => entry.key)).toEqual(['k2'])
    // No key of its own left: the other agent's key is not offered for removal, nor removed.
    await expect(agent.handle('status')).resolves.toMatchObject({
      hasKey: false,
      keyElsewhere: false,
    })
    await agent.handle('clearKey')
    expect(keys.map((entry) => entry.key)).toEqual(['k2'])
  })

  test('Remove the key with only keys no agent uses removes them', async () => {
    const agent = start([{id: 'aaaaaaaaaaaaaaaa', ...validation}])
    keys = [{provider: 'openai', address: 'https://old.test/v1', key: 'old'}]
    await expect(agent.handle('status')).resolves.toMatchObject({
      keyElsewhere: true,
    })
    await agent.handle('clearKey')
    expect(keys).toEqual([])
  })

  test("a line of no agent (a flip with no validation agent) is not in another agent's Activity", async () => {
    const agent = start([{id: 'bbbbbbbbbbbbbbbb', name: 'Other', model: 'm'}])
    await agent.handle('solveFlip', {flip})
    await expect(agent.handle('activity')).resolves.toHaveLength(1)
    await expect(
      agent.handle('activity', {agentId: 'bbbbbbbbbbbbbbbb'})
    ).resolves.toEqual([])
  })

  test('a write that fails leaves no Activity line', async () => {
    const agent = start([{id: 'aaaaaaaaaaaaaaaa', ...validation}])
    fs.chmodSync(dir, 0o500)
    try {
      await expect(agent.handle('saveAgent', {name: 'X'})).rejects.toThrow()
      await expect(
        agent.handle('removeAgent', {agentId: 'aaaaaaaaaaaaaaaa'})
      ).rejects.toThrow()
      await expect(agent.handle('setPaused', {paused: true})).rejects.toThrow()
    } finally {
      fs.chmodSync(dir, 0o700)
    }
    await expect(agent.handle('activity')).resolves.toEqual([])
  })

  test("a practice try on an agent's page uses that agent's connection", async () => {
    const agent = start([
      {id: 'aaaaaaaaaaaaaaaa', ...validation},
      {
        id: 'bbbbbbbbbbbbbbbb',
        name: 'Other',
        provider: 'openai',
        address: 'https://x.test/v1',
        model: 'other-model',
      },
    ])
    keys = [{provider: 'openai', address: 'https://x.test/v1', key: 'k-open'}]
    await agent.handle('testFlip', {flip, agentId: 'bbbbbbbbbbbbbbbb'})
    expect(ask.mock.calls[0][0]).toEqual({
      provider: 'openai',
      address: 'https://x.test/v1',
      model: 'other-model',
      key: 'k-open',
    })
    await agent.handle('testFlip', {flip})
    expect(ask.mock.calls[1][0].model).toBe('claude-opus-5-5')
  })

  test("an agent's Activity holds its own lines and those of all agents", async () => {
    const agent = start([
      {id: 'aaaaaaaaaaaaaaaa', ...validation},
      {id: 'bbbbbbbbbbbbbbbb', name: 'Other', model: 'm'},
    ])
    await agent.handle('solveFlip', {flip})
    await agent.handle('testFlip', {flip, agentId: 'bbbbbbbbbbbbbbbb'})
    await agent.handle('setPaused', {paused: true})
    // A flip refused while paused: the validation agent's line, not the other agent's.
    await agent.handle('solveFlip', {flip})
    const own = await agent.handle('activity', {agentId: 'bbbbbbbbbbbbbbbb'})
    expect(own.map((line) => line.action)).toEqual(['settings', 'test'])
    const validationLines = await agent.handle('activity', {
      agentId: 'aaaaaaaaaaaaaaaa',
    })
    expect(validationLines.map((line) => line.action)).toEqual([
      'answerFlip',
      'settings',
      'answerFlip',
    ])
    expect(await agent.handle('activity')).toHaveLength(4)
    // Asked with an empty value, as a script may: every line, not the lines of an agent "null".
    expect(await agent.handle('activity', null)).toHaveLength(4)
    expect(await agent.handle('activity', {})).toHaveLength(4)
  })
})
