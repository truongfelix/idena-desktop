const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')

// B-252: an agent's Activity can be cleared; the other agents' lines stay.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')
const flip = {
  images: [PNG, PNG, PNG, PNG],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  words: [],
}
const A = 'aaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbb'
const one = (id) => ({
  id,
  name: id === A ? 'A' : 'B',
  enabled: true,
  provider: 'anthropic',
  address: 'https://api.anthropic.com',
  model: 'm',
  actions: id === A ? {answerFlip: {level: 'alone'}} : {},
})

describe("an agent's Activity", () => {
  let dir
  let agent

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-activity-'))
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [one(A), one(B)],
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    let clock = 0
    agent = createAgent({
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
      ask: jest.fn().mockResolvedValue('{"answer":"left","confidence":0.8}'),
      now: () => {
        clock += 1
        return clock
      },
    })
  })
  afterEach(() => fs.removeSync(dir))

  const lines = async (agentId) =>
    (await agent.handle('activity', {agentId})).map(
      (x) => `${x.action} ${x.decision}`
    )

  test("Clear empties that agent's lines, the other's stay", async () => {
    await agent.handle('testFlip', {flip, agentId: A})
    await agent.handle('testFlip', {flip, agentId: B})
    await agent.handle('setPaused', {paused: true})
    expect(await lines(A)).toEqual(['settings paused', 'test answered'])

    await agent.handle('clearActivity', {agentId: A})
    // The pause of all agents, before the clear, is gone from A's page; B still shows it with its own line.
    expect(await lines(A)).toEqual([])
    expect(await lines(B)).toEqual(['settings paused', 'test answered'])

    // What comes after the clear shows again.
    await agent.handle('setPaused', {paused: false})
    await agent.handle('testFlip', {flip, agentId: A})
    expect(await lines(A)).toEqual(['test answered', 'settings resumed'])
  })

  test('Clear names its agent', async () => {
    await expect(agent.handle('clearActivity', {})).rejects.toThrow(
      'no agent named'
    )
  })
})
