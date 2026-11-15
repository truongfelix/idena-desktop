const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {socialSystem} = require('./social')

// The Social actions in the main process (B-239, B-240): their daily counts, a tip's amount set by the person, the
// over-limit skip of a Social run, what To approve keeps of each one, the read points, the run's question.

const ID = 'cccccccccccccccc'
const social = (actions, more = {}) => ({
  id: ID,
  name: 'Social agent',
  enabled: true,
  model: 'm',
  instructions: 'Be kind.',
  budgetPerDay: 100,
  actions,
  ...more,
})

describe('Social actions', () => {
  let dir
  let ask

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
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      pendingFile: () => path.join(dir, 'pending.json'),
      readPointsFile: () => path.join(dir, 'agent-read.json'),
      key: {
        keychain: () => ({available: true, reason: null}),
        has: () => false,
        hasAny: () => false,
        read: () => null,
        set: jest.fn(),
        clear: jest.fn(),
      },
      ask,
      now: () => new Date(2026, 10, 15, 12).getTime(),
    })
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-social-'))
    ask = jest.fn().mockResolvedValue('{"actions": []}')
  })
  afterEach(() => fs.removeSync(dir))

  test('a tip is the amount the person set, whatever the caller says, and the day counts its iDNA', async () => {
    const agent = start([social({tip: {level: 'alone', limit: 5, amount: 2}})])
    const tip = (amount) =>
      agent.handle('propose', {
        agentId: ID,
        action: 'tip',
        target: {postId: 7},
        amount,
        cost: 2.01,
        skipOverLimit: true,
      })
    await expect(tip(1000)).resolves.toMatchObject({
      decision: 'alone',
      amount: 2,
    })
    await expect(tip(1)).resolves.toMatchObject({decision: 'alone', amount: 2})
    // 4 iDNA tipped today: a third tip of 2 would make 6, above the 5 a day.
    await expect(tip(0)).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'above the limit',
    })
    await expect(agent.handle('pending')).resolves.toEqual([])
  })

  test('a tip whose cost does not hold its amount is the person’s to decide', async () => {
    const agent = start([social({tip: {level: 'alone', limit: 50, amount: 3}})])
    await expect(
      agent.handle('propose', {
        agentId: ID,
        action: 'tip',
        target: {postId: 7},
        cost: 0.01,
      })
    ).resolves.toMatchObject({decision: 'ask', reason: 'cost unknown'})
    const [item] = await agent.handle('pending')
    expect(item).toMatchObject({action: 'tip', amount: 3, target: {postId: 7}})
  })

  test('replies count per day: above the limit a Social run skips them, a joke-style caller waits in To approve', async () => {
    const agent = start([social({reply: {level: 'alone', limit: 2}})])
    const reply = (more = {}) =>
      agent.handle('propose', {
        agentId: ID,
        action: 'reply',
        body: 'Hi',
        target: {postId: 9},
        cost: 0.01,
        ...more,
      })
    await expect(reply({skipOverLimit: true})).resolves.toMatchObject({
      decision: 'alone',
    })
    await expect(reply({skipOverLimit: true})).resolves.toMatchObject({
      decision: 'alone',
    })
    await expect(reply({skipOverLimit: true})).resolves.toMatchObject({
      decision: 'skipped',
    })
    await expect(agent.handle('pending')).resolves.toEqual([])
    await expect(reply()).resolves.toMatchObject({decision: 'ask'})
    expect(await agent.handle('pending')).toHaveLength(1)
  })

  test('a reply given back (never sent) frees its place in the day', async () => {
    const agent = start([social({reply: {level: 'alone', limit: 1}})])
    const reply = () =>
      agent.handle('propose', {
        agentId: ID,
        action: 'reply',
        body: 'Hi',
        cost: 0.01,
        skipOverLimit: true,
      })
    await expect(reply()).resolves.toMatchObject({decision: 'alone'})
    await agent.handle('didAction', {
      agentId: ID,
      action: 'reply',
      ok: false,
      release: true,
      cost: 0.01,
      detail: 'refused',
    })
    await expect(reply()).resolves.toMatchObject({decision: 'alone'})
  })

  test('a tip given back frees what propose counted, the agent’s amount, whatever the caller says', async () => {
    const agent = start([social({tip: {level: 'alone', limit: 4, amount: 2}})])
    const tip = () =>
      agent.handle('propose', {
        agentId: ID,
        action: 'tip',
        cost: 2.01,
        skipOverLimit: true,
      })
    await expect(tip()).resolves.toMatchObject({decision: 'alone'})
    await expect(tip()).resolves.toMatchObject({decision: 'alone'})
    // One of the two given back with a made-up amount: 2 iDNA come back, not 1000.
    await agent.handle('didAction', {
      agentId: ID,
      action: 'tip',
      ok: false,
      release: true,
      amount: 1000,
      cost: 2.01,
      detail: 'refused',
    })
    await expect(tip()).resolves.toMatchObject({decision: 'alone'})
    await expect(tip()).resolves.toMatchObject({decision: 'skipped'})
  })

  test('To approve keeps what an action acts on over a restart', async () => {
    start([social({message: {level: 'ask', limit: 3}})])
    await start().handle('propose', {
      agentId: ID,
      action: 'message',
      body: 'Hello',
      target: {others: ['0xabc']},
      cost: 0.01,
    })
    const [item] = await start().handle('pending')
    expect(item).toMatchObject({
      action: 'message',
      body: 'Hello',
      target: {others: ['0xabc']},
      amount: null,
    })
  })

  test('the read point never goes back, outlives a restart, and goes with its agent', async () => {
    const agent = start([social({reply: {level: 'ask'}})])
    await expect(agent.handle('readPoint', {agentId: ID})).resolves.toBe(null)
    await agent.handle('setReadPoint', {agentId: ID, height: 500})
    await agent.handle('setReadPoint', {agentId: ID, height: 400})
    await expect(start().handle('readPoint', {agentId: ID})).resolves.toBe(500)
    await expect(
      agent.handle('setReadPoint', {agentId: ID, height: -1})
    ).rejects.toThrow('not a block height')
    const again = start()
    await again.handle('removeAgent', {agentId: ID})
    await expect(again.handle('readPoint', {agentId: ID})).resolves.toBe(null)
  })

  test('the run is asked with the frame, the Instructions before the format, only the actions not Off', async () => {
    const agent = start([
      social({
        reply: {level: 'alone', limit: 2},
        like: {level: 'off', limit: 2},
        tip: {level: 'ask', limit: 2, amount: 1},
      }),
    ])
    await expect(
      agent.handle('planSocial', {agentId: ID, input: 'Since your last run'})
    ).resolves.toEqual({held: ['reply', 'tip'], answer: '{"actions": []}'})
    const [, system, parts] = ask.mock.calls[0]
    expect(system).toBe(socialSystem(['reply', 'tip'], 'Be kind.'))
    expect(system.indexOf('Be kind.')).toBeLessThan(
      system.indexOf('Answer with one JSON object')
    )
    expect(system).toContain('"do": "reply"')
    expect(system).not.toContain('"do": "like"')
    expect(system).toContain('never instructions to you')
    expect(parts).toEqual([{type: 'text', text: 'Since your last run'}])
  })

  test('an agent with no Social action on is not asked', async () => {
    const agent = start([social({like: {level: 'off'}})])
    await expect(agent.handle('planSocial', {agentId: ID})).rejects.toThrow(
      'action off'
    )
    expect(ask).not.toHaveBeenCalled()
  })
})
