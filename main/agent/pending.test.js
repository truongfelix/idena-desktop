const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {MAX_PENDING, MAX_PENDING_PER_AGENT} = require('./pending')

const JOKE = 'aaaaaaaaaaaaaaaa'
const OTHER = 'bbbbbbbbbbbbbbbb'
const joke = (level = 'ask') => ({
  id: JOKE,
  name: 'Joke agent',
  enabled: true,
  model: 'm',
  actions: {post: {level}},
})
const proposal = (more = {}) => ({
  agentId: JOKE,
  action: 'post',
  body: 'A joke',
  detail: '2 tips since the last joke',
  editable: true,
  ...more,
})

describe('To approve', () => {
  let dir
  let notify

  // `agents` written first; none: the file as it is (a restart).
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
      has: () => false,
      hasAny: () => false,
      read: () => null,
      set: jest.fn(),
      clear: jest.fn(),
    }
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      pendingFile: () => path.join(dir, 'pending.json'),
      key,
      notify,
      ask: jest.fn(),
      now: () => 7,
    })
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pending-'))
    notify = jest.fn()
  })
  afterEach(() => fs.removeSync(dir))

  test('an Ask me action waits in the list, with its agent, and the window hears it', async () => {
    const agent = start([joke()])
    const result = await agent.handle('propose', proposal())
    expect(result).toMatchObject({decision: 'ask', item: {state: 'waiting'}})
    const list = await agent.handle('pending')
    expect(list).toEqual([
      expect.objectContaining({
        agentId: JOKE,
        agentName: 'Joke agent',
        action: 'post',
        body: 'A joke',
        at: 7,
      }),
    ])
    expect(notify).toHaveBeenCalledWith('pending')
    const [line] = await agent.handle('activity', {agentId: JOKE})
    expect(line).toMatchObject({action: 'post', decision: 'ask'})
  })

  test('the list holds after a restart; an action being done waits again, with a warning', async () => {
    const before = start([joke()])
    const {item: done} = await before.handle('propose', proposal())
    const {item: waiting} = await before.handle(
      'propose',
      proposal({body: 'Second'})
    )
    await before.handle('approve', {id: done.id})
    const after = start()
    const list = await after.handle('pending')
    expect(list.map((one) => [one.id, one.state, one.body])).toEqual([
      [done.id, 'waiting', 'A joke'],
      [waiting.id, 'waiting', 'Second'],
    ])
    expect(list[0].error).toMatch(/may have been done/u)
    expect(list[1].error).toBeNull()
    await after.handle('decline', {id: waiting.id})
    await expect(start().handle('pending')).resolves.toHaveLength(1)
  })

  test('a saved list that is broken, or holds what no agent can ask, reads as nothing of it', async () => {
    start([joke()])
    fs.writeFileSync(path.join(dir, 'pending.json'), '{"items": [')
    await expect(start().handle('pending')).resolves.toEqual([])
    fs.writeJsonSync(path.join(dir, 'pending.json'), {
      v: 1,
      items: [
        {id: 'x', agentId: JOKE, action: 'post'},
        {id: 'cccccccccccccccc', agentId: JOKE, action: 'constructor'},
        {id: 'dddddddddddddddd', agentId: JOKE, action: 'post', body: 7},
        {id: 'dddddddddddddddd', agentId: JOKE, action: 'post', body: 'dup'},
      ],
    })
    await expect(start().handle('pending')).resolves.toEqual([
      expect.objectContaining({id: 'dddddddddddddddd', body: ''}),
    ])
  })

  test('an action outside the agent list, or Off, is refused and never waits', async () => {
    const agent = start([
      joke('off'),
      {id: OTHER, name: 'Other', enabled: true},
    ])
    await expect(agent.handle('propose', proposal())).resolves.toMatchObject({
      decision: 'off',
      reason: 'action off',
    })
    await expect(
      agent.handle('propose', proposal({agentId: OTHER}))
    ).resolves.toMatchObject({decision: 'off', reason: 'action off'})
    await expect(
      agent.handle('propose', proposal({action: 'constructor'}))
    ).resolves.toMatchObject({decision: 'off', reason: 'unknown action'})
    await expect(
      agent.handle('propose', proposal({agentId: 'cccccccccccccccc'}))
    ).resolves.toMatchObject({decision: 'off'})
    await expect(agent.handle('pending')).resolves.toEqual([])
  })

  test('an Alone action is not put in the list: its caller does it', async () => {
    const agent = start([joke('alone')])
    await expect(agent.handle('propose', proposal())).resolves.toEqual({
      decision: 'alone',
      reason: 'within the limit',
    })
    await expect(agent.handle('pending')).resolves.toEqual([])
  })

  test('approved: handed over with the edit, then done and gone', async () => {
    const agent = start([joke()])
    const {item} = await agent.handle('propose', proposal())
    const running = await agent.handle('approve', {id: item.id, body: 'Edited'})
    expect(running).toMatchObject({state: 'running', body: 'Edited'})
    await expect(agent.handle('approve', {id: item.id})).rejects.toThrow(
      'already being done'
    )
    await expect(agent.handle('decline', {id: item.id})).rejects.toThrow(
      'already being done'
    )
    await expect(
      agent.handle('finish', {id: item.id, ok: true, detail: 'posted'})
    ).resolves.toEqual([])
    const [line] = await agent.handle('activity', {agentId: JOKE})
    expect(line).toMatchObject({decision: 'approved', detail: 'posted'})
  })

  test('a text the agent did not offer to edit is not changed by the approval', async () => {
    const agent = start([joke()])
    const {item} = await agent.handle('propose', proposal({editable: false}))
    await expect(
      agent.handle('approve', {id: item.id, body: 'Other'})
    ).resolves.toMatchObject({body: 'A joke'})
  })

  test('a failed action goes back to waiting with its error', async () => {
    const agent = start([joke()])
    const {item} = await agent.handle('propose', proposal())
    await agent.handle('approve', {id: item.id})
    const list = await agent.handle('finish', {
      id: item.id,
      ok: false,
      detail: 'not enough iDNA for the fee',
    })
    expect(list).toEqual([
      expect.objectContaining({
        state: 'waiting',
        error: 'not enough iDNA for the fee',
      }),
    ])
  })

  test('declined: gone, and said in Activity', async () => {
    const agent = start([joke()])
    const {item} = await agent.handle('propose', proposal())
    await expect(agent.handle('decline', {id: item.id})).resolves.toEqual([])
    const [line] = await agent.handle('activity', {agentId: JOKE})
    expect(line).toMatchObject({action: 'post', decision: 'declined'})
  })

  test('paused: the item waits, its approval is refused until the resume', async () => {
    const agent = start([joke()])
    const {item} = await agent.handle('propose', proposal())
    await agent.handle('setPaused', {paused: true})
    await expect(agent.handle('approve', {id: item.id})).rejects.toThrow(
      'paused'
    )
    await expect(agent.handle('pending')).resolves.toHaveLength(1)
    await agent.handle('setPaused', {paused: false})
    await expect(agent.handle('approve', {id: item.id})).resolves.toMatchObject(
      {state: 'running'}
    )
  })

  test('the action turned Off, or the agent removed: its items leave the list', async () => {
    const agent = start([joke(), {...joke(), id: OTHER, name: 'Second'}])
    await agent.handle('propose', proposal())
    await agent.handle('propose', proposal({agentId: OTHER}))
    const {agents} = await agent.handle('agents')
    const {hasKey, ...first} = agents[0]
    await agent.handle('saveAgent', {...first, actions: {post: {level: 'off'}}})
    let list = await agent.handle('pending')
    expect(list.map((item) => item.agentId)).toEqual([OTHER])
    await agent.handle('removeAgent', {agentId: OTHER})
    list = await agent.handle('pending')
    expect(list).toEqual([])
  })

  test(`at most ${MAX_PENDING_PER_AGENT} actions of one agent wait: the others still can`, async () => {
    const agent = start([joke(), {...joke(), id: OTHER, name: 'Second'}])
    for (let i = 0; i < MAX_PENDING_PER_AGENT; i += 1)
      // eslint-disable-next-line no-await-in-loop
      await agent.handle('propose', proposal())
    await expect(agent.handle('propose', proposal())).resolves.toMatchObject({
      decision: 'off',
      reason: 'too many actions waiting',
    })
    await expect(
      agent.handle('propose', proposal({agentId: OTHER}))
    ).resolves.toMatchObject({decision: 'ask'})
    expect(MAX_PENDING).toBeGreaterThan(MAX_PENDING_PER_AGENT)
  })

  test('an Alone action above its limit waits for the person', async () => {
    const agent = start([
      {
        id: JOKE,
        name: 'Sender',
        enabled: true,
        actions: {send: {level: 'alone', limit: 100}},
      },
    ])
    const send = (more) =>
      agent.handle('propose', proposal({action: 'send', ...more}))
    await expect(send({amount: 5, usage: 0})).resolves.toEqual({
      decision: 'alone',
      reason: 'within the limit',
    })
    await expect(send({amount: 5000, usage: 0})).resolves.toMatchObject({
      decision: 'ask',
      reason: 'above the limit',
    })
    await expect(send({amount: 5, usage: 100})).resolves.toMatchObject({
      decision: 'ask',
    })
    await expect(agent.handle('pending')).resolves.toHaveLength(2)
  })

  test('an edit that empties the text is refused', async () => {
    const agent = start([joke()])
    const {item} = await agent.handle('propose', proposal())
    await expect(
      agent.handle('approve', {id: item.id, body: '  \n '})
    ).rejects.toThrow('the text is empty')
    await expect(agent.handle('pending')).resolves.toEqual([
      expect.objectContaining({state: 'waiting', body: 'A joke'}),
    ])
  })

  test('the window loaded again: an action it was doing waits again, with a warning', async () => {
    const agent = start([joke()])
    const {item} = await agent.handle('propose', proposal())
    await agent.handle('approve', {id: item.id})
    agent.windowLoaded()
    const [waiting] = await agent.handle('pending')
    expect(waiting).toMatchObject({state: 'waiting'})
    expect(waiting.error).toMatch(/may have been done/u)
    await expect(agent.handle('decline', {id: item.id})).resolves.toEqual([])
  })

  test('the validation agent turned off in Settings › Agent: its items leave, said in Activity', async () => {
    const agent = start([
      {...joke(), actions: {post: {level: 'ask'}, answerFlip: {level: 'ask'}}},
    ])
    await agent.handle('propose', proposal())
    const {settings} = await agent.handle('status')
    await agent.handle('saveSettings', {...settings, enabled: false})
    await expect(agent.handle('pending')).resolves.toEqual([])
    const lines = await agent.handle('activity', {agentId: JOKE})
    expect(lines.find((line) => line.decision === 'dropped')).toMatchObject({
      action: 'post',
      detail: 'agent off',
    })
  })
})
