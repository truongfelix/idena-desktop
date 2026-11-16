const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')

// B-269 (owner 2026-11-16): how much on the actions that cost money. An action Alone spends within its own iDNA a
// day, the agent's overall limit (budgetPerDay, optional), or both; with none, it waits for the person.

const ID = 'dddddddddddddddd'

describe('the money limits of the actions', () => {
  let dir

  const start = (more) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [
        {
          id: ID,
          name: 'Social agent',
          enabled: true,
          model: 'm',
          budgetPerDay: null,
          ...more,
        },
      ],
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    const agent = createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      pendingFile: () => path.join(dir, 'pending.json'),
      key: {
        keychain: () => ({available: true, reason: null}),
        has: () => false,
        hasAny: () => false,
        read: () => null,
        set: jest.fn(),
        clear: jest.fn(),
      },
      ask: jest.fn(),
      now: () => new Date(2026, 10, 16, 12).getTime(),
    })
    const act = (action, cost, more2 = {}) =>
      agent.handle('propose', {
        agentId: ID,
        action,
        target: {postId: 7},
        body: 'x',
        cost,
        skipOverLimit: true,
        ...more2,
      })
    return act
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-money-'))
  })
  afterEach(() => fs.removeSync(dir))

  test('an action stops at its own iDNA a day while another goes on; one without a limit waits', async () => {
    const act = start({
      actions: {
        like: {level: 'alone', limit: 10, spendPerDay: 0.02},
        post: {level: 'alone', limit: null, spendPerDay: 1},
        reply: {level: 'alone', limit: 5},
      },
    })
    await expect(act('like', 0.01)).resolves.toMatchObject({decision: 'alone'})
    await expect(act('like', 0.01)).resolves.toMatchObject({decision: 'alone'})
    await expect(act('like', 0.01)).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'above its daily iDNA',
    })
    await expect(act('post', 0.01)).resolves.toMatchObject({decision: 'alone'})
    // No limit of its own and no overall one: it may spend nothing alone.
    await expect(act('reply', 0.01)).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'no budget',
    })
  })

  test('the overall limit stops every action, and covers one without a limit of its own', async () => {
    const act = start({
      budgetPerDay: 0.03,
      actions: {
        like: {level: 'alone', limit: 10, spendPerDay: 1},
        reply: {level: 'alone', limit: 5},
      },
    })
    await expect(act('like', 0.02)).resolves.toMatchObject({decision: 'alone'})
    await expect(act('reply', 0.01)).resolves.toMatchObject({decision: 'alone'})
    await expect(act('like', 0.01)).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'above the budget',
    })
    await expect(act('reply', 0.01)).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'above the budget',
    })
  })

  test("a tip's daily amount is its own limit: alone without an overall one", async () => {
    const act = start({actions: {tip: {level: 'alone', limit: 5, amount: 2}}})
    await expect(act('tip', 2.01, {amount: 2})).resolves.toMatchObject({
      decision: 'alone',
    })
  })

  test('the limits are kept with the agent; a broken one reads as none', async () => {
    start({
      actions: {
        like: {level: 'alone', limit: 10, spendPerDay: '0.5'},
        post: {level: 'alone', limit: null, spendPerDay: -1},
        flipStory: {level: 'ask', picturesPerDay: 4},
      },
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    const [agent] = profiles.read().agents
    expect(agent.actions.like.spendPerDay).toBe(0.5)
    expect(agent.actions.post.spendPerDay).toBeNull()
    expect(agent.actions.flipStory.picturesPerDay).toBe(4)
  })
})
