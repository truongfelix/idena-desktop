const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')

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
  budgetPerDay: 0.05,
  task: 'joke',
  ...more,
})

describe("an agent's runs: its text, its budget, what it did alone", () => {
  let dir
  let ask
  let clock

  // `agents` written first; none: the files as they are (a restart).
  const start = (agents) => {
    if (agents)
      fs.writeJsonSync(path.join(dir, 'agents.json'), {
        v: 1,
        paused: false,
        agents,
      })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    const key = {
      keychain: () => ({available: true, reason: null}),
      has: () => true,
      hasAny: () => true,
      read: (to) => (to.provider === 'anthropic' ? 'sk-joke' : null),
      set: jest.fn(),
      clear: jest.fn(),
    }
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      pendingFile: () => path.join(dir, 'pending.json'),
      key,
      ask,
      now: () => clock,
    })
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-'))
    ask = jest.fn().mockResolvedValue('A joke.')
    clock = new Date(2026, 10, 14, 9, 0).getTime()
  })
  afterEach(() => fs.removeSync(dir))

  test("the model gets the agent's instructions and the app's input, with its service's key", async () => {
    const agent = start([joke()])
    await expect(
      agent.handle('writeText', {
        agentId: JOKE,
        action: 'post',
        input: 'Recent: X',
      })
    ).resolves.toBe('A joke.')
    expect(ask).toHaveBeenCalledWith(
      {
        provider: 'anthropic',
        address: 'https://api.anthropic.com',
        model: 'claude-sonnet-5-5',
        maxTokens: null,
        effort: '',
        key: 'sk-joke',
      },
      'Write one joke.',
      [{type: 'text', text: 'Recent: X'}],
      expect.objectContaining({signal: expect.anything()})
    )
  })

  test("a change of another agent does not stop the joke's text; the pause does", async () => {
    const agent = start([joke(), {id: 'bbbbbbbbbbbbbbbb', name: 'Other'}])
    let release
    ask.mockImplementation(
      (config, system, parts, {signal}) =>
        new Promise((resolve, reject) => {
          release = () => resolve('A joke.')
          signal.addEventListener('abort', () => reject(new Error('stopped')))
        })
    )
    const tick = () =>
      new Promise((resolve) => {
        setImmediate(resolve)
      })
    const first = agent.handle('writeText', {agentId: JOKE, action: 'post'})
    await tick()
    const {agents} = await agent.handle('agents')
    const {hasKey, ...other} = agents[1]
    await agent.handle('saveAgent', {...other, name: 'Renamed'})
    release()
    await expect(first).resolves.toBe('A joke.')
    const second = agent.handle('writeText', {agentId: JOKE, action: 'post'})
    await tick()
    await agent.handle('setPaused', {paused: true})
    await expect(second).rejects.toThrow('stopped')
  })

  test('no text for an action outside its list, Off, paused, or without instructions', async () => {
    const write = (agents, action = 'post') =>
      start(agents).handle('writeText', {agentId: JOKE, action, input: ''})
    await expect(write([joke()], 'send')).rejects.toThrow('action off')
    await expect(
      write([joke({actions: {post: {level: 'off'}}})])
    ).rejects.toThrow('action off')
    await expect(write([joke({enabled: false})])).rejects.toThrow('agent off')
    await expect(write([joke({instructions: ' '})])).rejects.toThrow(
      'no instructions'
    )
    expect(ask).not.toHaveBeenCalled()
  })

  test('alone within its daily budget; above it, or with no budget, the action waits for the person', async () => {
    const agent = start([
      joke({actions: {post: {level: 'alone', limit: null}}}),
    ])
    const propose = (cost) =>
      agent.handle('propose', {agentId: JOKE, action: 'post', body: 'j', cost})
    await expect(propose(0.03)).resolves.toMatchObject({decision: 'alone'})
    await agent.handle('didAction', {
      agentId: JOKE,
      action: 'post',
      ok: true,
      cost: 0.03,
      detail: 'Joke #4',
    })
    await expect(propose(0.03)).resolves.toMatchObject({
      decision: 'ask',
      reason: 'above the budget',
    })
    // The next day, the budget is whole again.
    clock += 24 * 3600 * 1000
    await expect(propose(0.03)).resolves.toMatchObject({decision: 'alone'})
    const none = start([
      joke({
        budgetPerDay: null,
        actions: {post: {level: 'alone', limit: null}},
      }),
    ])
    await expect(
      none.handle('propose', {
        agentId: JOKE,
        action: 'post',
        body: 'j',
        cost: 0.01,
      })
    ).resolves.toMatchObject({decision: 'ask', reason: 'no budget'})
  })

  test('once a day: the second post of the day waits for the person', async () => {
    const agent = start([joke()])
    const propose = (usage) =>
      agent.handle('propose', {
        agentId: JOKE,
        action: 'post',
        body: 'j',
        usage,
        amount: 1,
        cost: 0.01,
      })
    await expect(propose(0)).resolves.toMatchObject({decision: 'alone'})
    await expect(propose(1)).resolves.toMatchObject({
      decision: 'ask',
      reason: 'above the limit',
    })
  })

  const postAlone = (agent, more = {}) =>
    agent.handle('propose', {
      agentId: JOKE,
      action: 'post',
      body: 'j',
      usage: 0,
      amount: 1,
      cost: 0.01,
      ...more,
    })

  test('a post going alone counts at once: a second run meanwhile waits', async () => {
    const agent = start([joke()])
    await expect(postAlone(agent)).resolves.toMatchObject({decision: 'alone'})
    // The first is still being posted (no didAction yet), the app's own count still says 0.
    await expect(postAlone(agent)).resolves.toMatchObject({
      decision: 'ask',
      reason: 'above the limit',
    })
  })

  test('a post never sent is given back to the day; a post sent and not seen in a block stays counted', async () => {
    const agent = start([joke({actions: {post: {level: 'alone', limit: 1}}})])
    await postAlone(agent)
    await agent.handle('didAction', {
      agentId: JOKE,
      action: 'post',
      ok: false,
      release: true,
      cost: 0.01,
      detail: 'the node refused it',
    })
    await expect(postAlone(agent)).resolves.toMatchObject({decision: 'alone'})
    await agent.handle('didAction', {
      agentId: JOKE,
      action: 'post',
      ok: false,
      release: false,
      cost: 0.01,
      detail: 'not in a block yet',
    })
    await expect(postAlone(agent)).resolves.toMatchObject({decision: 'ask'})
  })

  test("the day's count and spending hold over a restart", async () => {
    const before = start([joke({budgetPerDay: 0.015})])
    await expect(postAlone(before)).resolves.toMatchObject({decision: 'alone'})
    const after = start()
    await expect(postAlone(after)).resolves.toMatchObject({
      decision: 'ask',
      reason: 'above the limit',
    })
    // The budget too: 0.01 of 0.015 spent, the next 0.01 is above it, even with a limit left.
    const {agents} = await after.handle('agents')
    const {hasKey, ...saved} = agents[0]
    await after.handle('saveAgent', {
      ...saved,
      actions: {post: {level: 'alone', limit: 5}},
    })
    await expect(postAlone(after)).resolves.toMatchObject({
      decision: 'ask',
      reason: 'above the budget',
    })
  })

  test('a usage that is not a count is not taken as 0', async () => {
    const agent = start([joke()])
    await postAlone(agent, {cost: 0})
    await expect(postAlone(agent, {usage: 'abc'})).resolves.toMatchObject({
      decision: 'ask',
      reason: 'count unknown',
    })
  })

  test('an approved post counts for the day too', async () => {
    const agent = start([joke({actions: {post: {level: 'ask', limit: 1}}})])
    const {item} = await agent.handle('propose', {
      agentId: JOKE,
      action: 'post',
      body: 'j',
    })
    await agent.handle('approve', {id: item.id})
    await agent.handle('finish', {id: item.id, ok: true})
    const {agents} = await agent.handle('agents')
    const {hasKey, ...saved} = agents[0]
    await agent.handle('saveAgent', {
      ...saved,
      actions: {post: {level: 'alone', limit: 1}},
    })
    await expect(
      agent.handle('propose', {
        agentId: JOKE,
        action: 'post',
        body: 'j',
        usage: 0,
        amount: 1,
        cost: 0.01,
      })
    ).resolves.toMatchObject({decision: 'ask', reason: 'above the limit'})
  })

  test('a day without a joke is said skipped', async () => {
    const agent = start([joke()])
    await agent.handle('didAction', {
      agentId: JOKE,
      action: 'post',
      skipped: true,
      detail: 'no tip since Joke #3',
    })
    const [line] = await agent.handle('activity', {agentId: JOKE})
    expect(line).toMatchObject({
      decision: 'skipped',
      detail: 'no tip since Joke #3',
    })
  })

  test('what it did alone shows in its Activity', async () => {
    const agent = start([joke()])
    await agent.handle('didAction', {
      agentId: JOKE,
      action: 'post',
      ok: true,
      detail: 'Joke #4',
    })
    await agent.handle('didAction', {
      agentId: JOKE,
      action: 'post',
      ok: false,
      detail: 'no iDNA for the fee',
    })
    const lines = await agent.handle('activity', {agentId: JOKE})
    expect(lines.map((l) => [l.decision, l.detail])).toEqual([
      ['failed', 'no iDNA for the fee'],
      ['alone', 'Joke #4'],
    ])
    await expect(
      agent.handle('didAction', {agentId: 'bbbbbbbbbbbbbbbb', action: 'post'})
    ).rejects.toThrow('no such agent')
  })
})
