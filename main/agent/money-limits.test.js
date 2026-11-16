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

  test("a tip's daily amount counts the iDNA tipped, never its fees: alone only within an iDNA a day", async () => {
    // As before B-269: a daily amount and no budget, the tip waits for the person.
    let act = start({actions: {tip: {level: 'alone', limit: 5, amount: 2}}})
    await expect(act('tip', 2.01, {amount: 2})).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'no budget',
    })
    act = start({
      actions: {tip: {level: 'alone', limit: 5, amount: 2, spendPerDay: 4.1}},
    })
    await expect(act('tip', 2.01, {amount: 2})).resolves.toMatchObject({
      decision: 'alone',
    })
    // The second tip's fees would pass the 4.1 a day, fees included.
    await expect(act('tip', 2.1, {amount: 2})).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'above its daily iDNA',
    })
  })

  test("a day's tally of a build before: each action as if it spent all the agent spent today", async () => {
    fs.writeJsonSync(path.join(dir, 'pending.json'), {
      v: 1,
      items: [],
      tally: {
        day: new Date(2026, 10, 16, 12).toDateString(),
        spent: {[ID]: 4},
        done: {},
      },
    })
    const act = start({
      actions: {post: {level: 'alone', limit: null, spendPerDay: 5}},
    })
    await expect(act('post', 0.5)).resolves.toMatchObject({decision: 'alone'})
    await expect(act('post', 0.6)).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'above its daily iDNA',
    })
    // After a restart (the tally saved since), it still counts what the build before spent.
    const again = start({
      actions: {post: {level: 'alone', limit: null, spendPerDay: 5}},
    })
    await expect(again('post', 0.6)).resolves.toMatchObject({
      decision: 'skipped',
      reason: 'above its daily iDNA',
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
