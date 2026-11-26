const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {storyQuestion, storySystem} = require('./stories')

// B-236: "Write flip stories" is an action of the agent's list, checked in the main process like every other.

const A = 'aaaaaaaaaaaaaaaa'
const WORDS = [{name: 'ladder'}, {name: 'kite'}]
const PARTS = ['story', 'prompts']
const REPLY = JSON.stringify({
  stories: [
    {
      title: 'Up the ladder',
      story: 'A boy climbs a ladder to free his kite.',
      prompts: [1, 2, 3].map((n) => `Picture ${n}, a ladder and a kite.`),
    },
  ],
})
const RUN = {agentId: A, words: WORDS, idea: 'A windy day.', parts: PARTS}

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

  test('allowed: the Instructions and the format as system text, the data of the run as the question, the stories come back', async () => {
    const agent = start({flipStory: {level: 'ask'}})
    const written = await agent.handle('writeStory', RUN)
    expect(written.stories[0].prompts).toEqual(
      [1, 2, 3].map((n) => `Picture ${n}, a ladder and a kite.`)
    )
    const [, system, question, opts] = ask.mock.calls[0]
    expect(system).toBe(storySystem('Cartoon style.'))
    expect(question).toEqual([
      {
        type: 'text',
        text: storyQuestion({words: WORDS, idea: 'A windy day.', parts: PARTS}),
      },
    ])
    // Room for four prompts of 120 words: more than a flip's answer.
    expect(opts.maxTokens).toBeGreaterThanOrEqual(2048)
    const [line] = await agent.handle('activity', {agentId: A})
    expect(line).toMatchObject({
      action: 'flipStory',
      decision: 'ask',
      detail: 'Up the ladder',
    })
  })

  test('not in its list, Off, or the agent off: refused, nothing asked', async () => {
    for (const [actions, more, reason] of [
      [{}, {}, 'action off'],
      [{flipStory: {level: 'off'}}, {}, 'action off'],
      [{flipStory: {level: 'alone'}}, {enabled: false}, 'agent off'],
    ]) {
      const agent = start(actions, more)
      await expect(agent.handle('writeStory', RUN)).rejects.toThrow(reason)
    }
    expect(ask).not.toHaveBeenCalled()
  })

  test('an answer without the prompts asked is an error, logged', async () => {
    ask.mockResolvedValue(
      JSON.stringify({stories: [{title: 'Words only', story: 'S'}]})
    )
    const agent = start({flipStory: {level: 'alone'}})
    await expect(agent.handle('writeStory', RUN)).rejects.toThrow(
      'no image prompt'
    )
    const [line] = await agent.handle('activity', {agentId: A})
    expect(line).toMatchObject({action: 'flipStory', decision: 'failed'})
  })
})
