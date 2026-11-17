const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {
  fillSlots,
  maxLength,
  namedLines,
  namedText,
  normalizeParts,
} = require('./app-parts')
const {defaultParts} = require('./app-texts')
const {checkFlip, flipQuestion} = require('./flips')
const {storyQuestion} = require('./stories')
const {ACTION_LINES, SOCIAL_ACTIONS, socialSystem} = require('./social')
const {buildImageRequest} = require('./providers')

// B-285 (ruling Q-66): the words the app writes around the data of each question, each a text an agent may change.
const ID = 'eeeeeeeeeeeeeeee'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')
const JPEG = Buffer.from([0xff, 0xd8, 2]).toString('base64')
const WORDS = [{name: 'kite', desc: 'a toy that flies'}, {name: 'storm'}]
const flip = (words = WORDS) => ({
  images: [PNG, JPEG, PNG, JPEG],
  orders: [
    [0, 1, 2, 3],
    [3, 1, 0, 2],
  ],
  words,
})
const defaults = defaultParts()

describe('a text with slots', () => {
  test('each slot is filled once: a value holding a slot of its own stays words', () => {
    expect(fillSlots('A {{one}} B {{two}}', {one: '{{two}}', two: 'x'})).toBe(
      'A {{two}} B x'
    )
    // A slot the text does not know stays as written.
    expect(fillSlots('A {{other}}', {one: 'x'})).toBe('A {{other}}')
  })

  test('a paragraph whose slots all hold nothing is left out; one with something stays', () => {
    const text = 'Head:\n{{a}}\n\nIdea:\n{{b}}\n\nEnd {{a}}{{b}}.\n\nNo slot.'
    expect(fillSlots(text, {a: 'x', b: ''})).toBe(
      'Head:\nx\n\nEnd x.\n\nNo slot.'
    )
    expect(fillSlots(text, {a: '', b: ''})).toBe('No slot.')
    expect(fillSlots(text, {a: '', b: ''}, {drop: false})).toBe(
      'Head:\n\n\nIdea:\n\n\nEnd .\n\nNo slot.'
    )
  })

  test('a required value without its slot goes at the end', () => {
    expect(
      fillSlots('Only {{a}}.', {a: 'x', b: 'y'}, {required: ['a', 'b']})
    ).toBe('Only x.\n\ny')
  })

  test('named lines: the first line of each known name, its own spaces kept', () => {
    expect(
      namedLines('a: one\nb:   two: three\nc: no\na: again\nnot a line', [
        'a',
        'b',
      ])
    ).toEqual({a: 'one', b: '  two: three'})
    expect(namedLines(namedText(ACTION_LINES), SOCIAL_ACTIONS)).toEqual(
      ACTION_LINES
    )
  })

  test('a shorter text is cut at its own longest', () => {
    expect(maxLength('imageSize')).toBe(20)
    expect(
      normalizeParts({imageSize: '9'.repeat(50)}, defaults).imageSize
    ).toHaveLength(20)
  })
})

describe('the default texts, filled, are what the app sends without a change', () => {
  test('the story question, with and without an idea and earlier titles', () => {
    ;[
      {words: WORDS, parts: ['story', 'prompts']},
      {words: WORDS, parts: ['prompts'], idea: 'A windy day.'},
      {words: WORDS, parts: ['story'], notThese: ['One', 'Two']},
      {
        words: WORDS,
        parts: ['story', 'prompts'],
        idea: 'A windy day.',
        notThese: ['One'],
      },
    ].forEach((asked) =>
      expect(storyQuestion(asked, defaults.storyQuestion)).toBe(
        storyQuestion(asked)
      )
    )
  })

  test('the flip question: the same words and the same pictures in the same places', () => {
    const flat = ({parts}) =>
      parts
        .map((part) =>
          part.type === 'image' ? `<${part.mediaType} ${part.data}>` : part.text
        )
        .join('\n')
    ;[flip(), flip([])].forEach((one) => {
      const checked = checkFlip(one)
      expect(flat(flipQuestion(checked, '', null, defaults))).toBe(
        flat(flipQuestion(checked))
      )
    })
  })

  test('the action lines and the picture request', () => {
    expect(
      socialSystem(['reply', 'tip'], 'Be brief.', null, defaults.socialActions)
    ).toBe(socialSystem(['reply', 'tip'], 'Be brief.'))
    const config = {
      provider: 'openai',
      address: 'https://images.example/v1',
      imageModel: 'img-1',
      key: 'sk-x',
    }
    expect(buildImageRequest(config, 'A kite.', defaults)).toEqual(
      buildImageRequest(config, 'A kite.')
    )
  })
})

describe('an edited flip question', () => {
  test('the pictures go at their slots, once; a keyword holding a slot stays words', () => {
    const checked = checkFlip(
      flip([{name: 'kite', desc: '{{right}}'}, {name: 'storm'}])
    )
    const {parts} = flipQuestion(checked, '', null, {
      flipQuestion:
        'Words: {{keywords}}\nSecond:\n{{right}}\nFirst:\n{{left}}\n{{left}}Go.',
    })
    expect(parts.map((part) => part.type)).toEqual([
      'text',
      ...Array(4).fill('image'),
      'text',
      ...Array(4).fill('image'),
      'text',
    ])
    expect(parts[0].text).toBe('Words: kite ({{right}}), storm\nSecond:')
    expect(parts[5].text).toBe('First:')
    expect(parts[10].text).toBe('Go.')
    // The right order first, as written: its pictures are the right order's.
    expect(parts[1].mediaType).toBe('image/jpeg')
    expect(parts[6].mediaType).toBe('image/png')
  })

  test('pictures without their slot go at the end, the left order first', () => {
    const {parts} = flipQuestion(checkFlip(flip([])), '', null, {
      flipQuestionShort: 'Which order tells a story?',
    })
    expect(parts.map((part) => part.type)).toEqual([
      'text',
      ...Array(8).fill('image'),
    ])
    expect(parts[1].mediaType).toBe('image/png')
    expect(parts[5].mediaType).toBe('image/jpeg')
  })
})

describe('what is sent', () => {
  let dir
  let ask
  let draw

  const start = (appParts) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [
        {
          id: ID,
          name: 'Agent',
          enabled: true,
          provider: 'openai',
          address: 'https://images.example/v1',
          model: 'm',
          imageModel: 'img-1',
          instructions: 'Be kind.',
          actions: {
            reply: {level: 'alone', limit: 2},
            tip: {level: 'ask'},
            answerFlip: {level: 'ask'},
            flipStory: {level: 'ask'},
            flipPictures: {level: 'ask', picturesPerDay: 5},
          },
          flipSteps: true,
          ...(appParts ? {appParts} : {}),
        },
      ],
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
      partsFile: () => path.join(dir, 'agent-parts.json'),
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
          has: () => true,
          hasAny: () => true,
          read: () => 'sk-x',
          set: jest.fn(),
          clear: jest.fn(),
        },
        ask,
        draw,
        now: () => new Date(2026, 10, 15, 12).getTime(),
      }),
    }
  }

  const MINE = {
    storyQuestion:
      'Two words: {{keyword1}} / {{keyword2}}.\n\nWanted: {{asked}}.',
    imagePrompt: 'A flat drawing. {{prompt}}',
    imageSize: '512x512',
    flipQuestion: 'Words: {{keywords}}\nA:\n{{left}}\nB:\n{{right}}\nJSON:',
    socialActions:
      'reply: {"do": "reply", "to": "p1", "text": "..."}: answer it.',
  }

  /** Each question of an agent, as the model's service gets it. */
  const sendAll = async (agent) => {
    ask.mockResolvedValue(
      '{"stories": [{"title": "T", "story": "S", "prompts": ["p"]}]}'
    )
    await agent.handle('writeStory', {
      agentId: ID,
      words: WORDS,
      parts: ['story', 'prompts'],
    })
    await agent.handle('drawStoryPicture', {agentId: ID, prompt: 'A kite.'})
    ask.mockResolvedValue('{"answer":"left","confidence":0.8}')
    await agent.handle('testFlip', {flip: flip(), agentId: ID})
    await agent.handle('testFlip', {flip: flip([]), agentId: ID})
    ask.mockResolvedValue('{"actions": []}')
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    const text = (parts) =>
      parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('|')
    return {
      story: ask.mock.calls[0][2][0].text,
      picture: buildImageRequest(...draw.mock.calls[0].slice(0, 2), {
        ...draw.mock.calls[0][2].texts,
      }).body,
      flip: text(ask.mock.calls[1][2]),
      shortFlip: text(ask.mock.calls[2][2]),
      social: ask.mock.calls[3][1],
    }
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sent-'))
    ask = jest.fn()
    draw = jest.fn().mockResolvedValue({mediaType: 'image/png', data: PNG})
  })
  afterEach(() => fs.removeSync(dir))

  test('each edited text is sent as edited; the others as the app writes them', async () => {
    const {agent, profiles} = start(MINE)
    expect(profiles.read().agents[0].appParts).toEqual(MINE)
    const sent = await sendAll(agent)
    expect(sent.story).toBe(
      'Two words: kite (a toy that flies) / storm.\n\nWanted: the story and the image prompts.'
    )
    expect(sent.picture).toMatchObject({
      prompt: 'A flat drawing. A kite.',
      size: '512x512',
    })
    expect(sent.flip).toBe('Words: kite (a toy that flies), storm\nA:|B:|JSON:')
    // Not edited: the question without keywords, and Social's frame around the edited line.
    expect(sent.shortFlip).toBe(
      'No keywords: leave "keywords" null and "reasons" empty.|LEFT order, pictures 1 to 4:|RIGHT order, pictures 1 to 4:|Your JSON answer:'
    )
    expect(sent.social).toBe(
      socialSystem(['reply', 'tip'], 'Be kind.').replace(
        ACTION_LINES.reply,
        '{"do": "reply", "to": "p1", "text": "..."}: answer it.'
      )
    )
    expect(sent.social).toContain(`- ${ACTION_LINES.tip}`)
  })

  test('back to the default restores each: an agent saved without them is asked as before', async () => {
    const {agent: edited, profiles} = start(MINE)
    const [saved] = profiles.read().agents
    profiles.write({...profiles.read(), agents: [{...saved, appParts: {}}]})
    expect('appParts' in profiles.read().agents[0]).toBe(false)
    const restored = await sendAll(edited)
    ask.mockClear()
    draw.mockClear()
    fs.removeSync(path.join(dir, 'pending.json'))
    const never = await sendAll(start().agent)
    expect(restored).toEqual(never)
    expect(never.picture).toMatchObject({prompt: 'A kite.', size: '1024x1024'})
    expect(never.story).toBe(
      storyQuestion({words: WORDS, parts: ['story', 'prompts']})
    )
  })
})
