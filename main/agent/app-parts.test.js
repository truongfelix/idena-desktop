const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {
  ACTIONS_SLOT,
  INSTRUCTIONS_SLOT,
  MAX_PART_LENGTH,
  fillPart,
  normalizeParts,
} = require('./app-parts')
const {appTexts, defaultParts} = require('./app-texts')
const {flipSystem} = require('./flips')
const {storySystem} = require('./stories')
const {SOCIAL_ACTIONS, socialSystem} = require('./social')

// B-282: the app's part of a question, unlocked per area.
const ID = 'eeeeeeeeeeeeeeee'
const PIXEL = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')
const flip = {
  images: [PIXEL, PIXEL, PIXEL, PIXEL],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  words: [],
}

describe('the default parts', () => {
  test('each with its slots filled is what the app sends without a change', () => {
    const parts = defaultParts()
    expect(Object.keys(parts)).toEqual(['flipStory', 'validation', 'social'])
    expect(fillPart(parts.flipStory, {instructions: 'Be brief.'})).toBe(
      storySystem('Be brief.')
    )
    expect(fillPart(parts.validation, {instructions: 'Be brief.'})).toBe(
      flipSystem('Be brief.')
    )
    expect(parts.social).toContain(ACTIONS_SLOT)
    expect(parts.social).toContain(INSTRUCTIONS_SLOT)
    // The same text through the custom path: the default as a template loses nothing.
    expect(socialSystem(['reply', 'tip'], 'Be brief.', parts.social)).toBe(
      socialSystem(['reply', 'tip'], 'Be brief.')
    )
    expect(appTexts({held: SOCIAL_ACTIONS}).parts).toEqual(parts)
  })
})

describe('an unlocked part', () => {
  test('its slots are filled; without the slot, the Instructions go at its end', () => {
    expect(
      fillPart(`A ${INSTRUCTIONS_SLOT} B ${ACTIONS_SLOT} C`, {
        instructions: ' mine ',
        actions: '- x',
      })
    ).toBe('A mine B - x C')
    expect(fillPart('No slot.', {instructions: 'Mine.'})).toBe(
      'No slot.\n\nMine.'
    )
    expect(fillPart('No slot.', {instructions: ''})).toBe('No slot.')
    // The actions too: a Social text without their slot still lists them, before the Instructions.
    expect(fillPart('Frame.', {instructions: 'Mine.', actions: '- x'})).toBe(
      'Frame.\n\n- x\n\nMine.'
    )
  })

  test('without Instructions, the slot goes with the line that announces it', () => {
    const parts = defaultParts()
    const flips = fillPart(parts.validation, {instructions: ''})
    expect(flips).not.toContain('The instructions of the person who runs you')
    expect(flips).not.toContain(INSTRUCTIONS_SLOT)
    expect(flips).toBe(flipSystem(''))
    const social = fillPart(parts.social, {instructions: '', actions: '- x'})
    expect(social).not.toContain('Instructions from the person you act for')
    expect(social).toContain('- x')
    expect(fillPart(parts.flipStory, {instructions: ''})).toBe(storySystem(''))
    // A slot inside a line only loses its name.
    expect(fillPart(`Do this: ${INSTRUCTIONS_SLOT} now.`, {})).toBe(
      'Do this:  now.'
    )
  })

  test('kept only for a known area, when it is a text that differs from the default', () => {
    const defaults = defaultParts()
    expect(
      normalizeParts(
        {
          social: 'My own frame',
          validation: `${defaults.validation}\n`,
          flipStory: '   ',
          other: 'x',
        },
        defaults
      )
    ).toEqual({social: 'My own frame'})
    expect(
      normalizeParts({social: 'x'.repeat(MAX_PART_LENGTH + 1)}, defaults)
    ).toEqual({})
    expect(normalizeParts(null, defaults)).toEqual({})
  })
})

describe('what is sent', () => {
  let dir
  let ask

  const start = (appParts) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [
        {
          id: ID,
          name: 'Agent',
          enabled: true,
          model: 'm',
          instructions: 'Be kind.',
          actions: {
            reply: {level: 'alone', limit: 2},
            answerFlip: {level: 'ask'},
          },
          ...(appParts ? {appParts} : {}),
        },
      ],
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    return {
      profiles,
      agent: createAgent({
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
      }),
    }
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-parts-'))
    ask = jest.fn().mockResolvedValue('{"actions": []}')
  })
  afterEach(() => fs.removeSync(dir))

  test('an unlocked Social text is sent as edited; the validation still gets the default', async () => {
    const mine = `My frame.\n${INSTRUCTIONS_SLOT}\nYou may:\n${ACTIONS_SLOT}\nAnswer in JSON.`
    const {agent, profiles} = start({social: mine})
    expect(profiles.read().agents[0].appParts).toEqual({social: mine})
    await agent.handle('planSocial', {
      agentId: ID,
      input: 'Since your last run',
    })
    expect(ask.mock.calls[0][1]).toBe(
      'My frame.\nBe kind.\nYou may:\n- {"do": "reply", "to": "p3", "text": "..."}: a reply to the post, reply or comment p3.\nAnswer in JSON.'
    )
    ask.mockResolvedValue('{"answer":"left","confidence":0.8}')
    await agent.handle('testFlip', {flip, agentId: ID})
    expect(ask.mock.calls[1][1]).toBe(flipSystem('Be kind.'))
  })

  test('an unlocked validation text is sent for its flips; Social still gets the default', async () => {
    const {agent} = start({validation: 'Pick a side. Answer in JSON.'})
    ask.mockResolvedValue('{"answer":"left","confidence":0.8}')
    await agent.handle('testFlip', {flip, agentId: ID})
    expect(ask.mock.calls[0][1]).toBe(
      'Pick a side. Answer in JSON.\n\nBe kind.'
    )
    ask.mockResolvedValue('{"actions": []}')
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    expect(ask.mock.calls[1][1]).toBe(socialSystem(['reply'], 'Be kind.'))
  })

  test('back to the default: an agent saved without its part holds none', () => {
    const {profiles} = start({social: defaultParts().social})
    expect('appParts' in profiles.read().agents[0]).toBe(false)
    expect('appParts' in start().profiles.read().agents[0]).toBe(false)
  })
})
