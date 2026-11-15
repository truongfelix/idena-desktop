const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {storySystem} = require('./stories')

// B-236: "Write flip stories" is an action of the agent's list, checked in the main process like every other.

const A = 'aaaaaaaaaaaaaaaa'
const WORDS = [{name: 'ladder'}, {name: 'kite'}]
const REPLY = [1, 2, 3]
  .map((n) => `**Image Prompt ${n}:** Panel ${n}, a ladder and a kite.`)
  .join('\n\n')

describe('the Write flip stories action', () => {
  let dir
  let ask

  const start = (actions, more = {}) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [
        {
          id: A,
          name: 'Story agent',
          enabled: true,
          provider: 'anthropic',
          address: 'https://api.anthropic.com',
          model: 'm',
          instructions: 'Cartoon style.',
          actions,
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

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-story-'))
    ask = jest.fn().mockResolvedValue(REPLY)
  })
  afterEach(() => fs.removeSync(dir))

  test('allowed: the template with the keywords and the Instructions is sent, the prompts come back', async () => {
    const agent = start({flipStory: {level: 'ask'}})
    const story = await agent.handle('writeStory', {
      agentId: A,
      panels: 3,
      words: WORDS,
    })
    expect(story.prompts).toEqual(
      [1, 2, 3].map((n) => `Panel ${n}, a ladder and a kite.`)
    )
    const [, system, , opts] = ask.mock.calls[0]
    expect(system).toBe(storySystem(3, WORDS, 'Cartoon style.'))
    // Room for four prompts of 120 words: more than a flip's answer.
    expect(opts.maxTokens).toBeGreaterThanOrEqual(2048)
    const [line] = await agent.handle('activity', {agentId: A})
    expect(line).toMatchObject({action: 'flipStory', decision: 'ask'})
  })

  test('not in its list, Off, or the agent off: refused, nothing asked', async () => {
    for (const [actions, more, reason] of [
      [{}, {}, 'action off'],
      [{flipStory: {level: 'off'}}, {}, 'action off'],
      [{flipStory: {level: 'alone'}}, {enabled: false}, 'agent off'],
    ]) {
      const agent = start(actions, more)
      await expect(
        agent.handle('writeStory', {agentId: A, panels: 3, words: WORDS})
      ).rejects.toThrow(reason)
    }
    expect(ask).not.toHaveBeenCalled()
  })

  test('an answer without all its prompts is an error, logged', async () => {
    const agent = start({flipStory: {level: 'alone'}})
    await expect(
      agent.handle('writeStory', {agentId: A, panels: 4, words: WORDS})
    ).rejects.toThrow('no prompt for panel 4')
    const [line] = await agent.handle('activity', {agentId: A})
    expect(line).toMatchObject({action: 'flipStory', decision: 'failed'})
  })
})
