const {
  FORMAT,
  MAX_PROMPTS,
  readStories,
  storyQuestion,
  storySystem,
} = require('./stories')

// B-268 (owner 2026-11-16): the model gets the person's Instructions, the action's data and the answer's format,
// nothing else of the app's.

const WORDS = [{name: 'ladder', desc: 'a set of steps'}, {name: 'kite'}]
const BOTH = ['story', 'prompts']

describe('what a story run sends', () => {
  test('the system text: the Instructions, then the format; the format alone without Instructions', () => {
    expect(storySystem('Draw everything as a watercolour.')).toBe(
      `Draw everything as a watercolour.\n\n${FORMAT}`
    )
    expect(storySystem('')).toBe(FORMAT)
    expect(storySystem('   ')).toBe(FORMAT)
    // No story rules of the app's: no panels, no storyteller, no template.
    expect(FORMAT).not.toMatch(/panel|storyteller|12-year-old|waking/iu)
  })

  test('without a number in the Instructions, the format asks one story with four image prompts (B-283)', () => {
    expect(storySystem('')).toContain(
      'Unless the instructions above ask for another number: one story, with 4 image prompts.'
    )
    // The Instructions still come first: a number of theirs is the one the line defers to.
    const system = storySystem('Three stories of six pictures.')
    expect(system.indexOf('Three stories')).toBeLessThan(
      system.indexOf('Unless the instructions above')
    )
  })

  test('the question: the keywords, the idea, the parts asked and the stories given before', () => {
    expect(
      storyQuestion({
        words: WORDS,
        idea: '  A cat who wants the fish on the table, 6 scenes. ',
        parts: BOTH,
        notThese: ['The kite on the roof', ' '],
      })
    ).toBe(
      [
        "The flip's two keywords:",
        '1. ladder (a set of steps)',
        '2. kite',
        '',
        'The idea of the person for this story:',
        'A cat who wants the fish on the table, 6 scenes.',
        '',
        'Asked: the story and the image prompts.',
        '',
        'Stories given before, not to give again:',
        '- The kite on the roof',
      ].join('\n')
    )
    // Without an idea nor earlier stories, only the keywords and the parts.
    expect(storyQuestion({words: WORDS, parts: ['prompts']})).toBe(
      [
        "The flip's two keywords:",
        '1. ladder (a set of steps)',
        '2. kite',
        '',
        'Asked: the image prompts.',
      ].join('\n')
    )
  })

  test('a keyword like "$&" stays as it is; a long description is cut, not refused', () => {
    const question = storyQuestion({
      words: [{name: '$&'}, {name: 'kite', desc: 'x'.repeat(500)}],
      parts: ['story'],
    })
    expect(question).toContain('1. $&\n')
    expect(question).toContain(`2. kite (${'x'.repeat(200)})`)
  })

  test('refused: not two keywords, or no part asked', () => {
    expect(() => storyQuestion({words: [WORDS[0]], parts: BOTH})).toThrow(
      'two keywords'
    )
    expect(() =>
      storyQuestion({words: [WORDS[0], {name: ' '}], parts: BOTH})
    ).toThrow('two keywords')
    expect(() => storyQuestion({words: WORDS, parts: []})).toThrow(
      'the story, the prompts or both'
    )
    expect(() => storyQuestion({words: WORDS, parts: ['images']})).toThrow(
      'the story, the prompts or both'
    )
  })
})

const reply = (stories) => JSON.stringify({stories})
const prompts = (n, tag = '') =>
  Array.from({length: n}, (_, i) => `${tag}picture ${i + 1}`)

describe('the answer read', () => {
  test('three stories of four pictures: twelve prompts, each story apart', () => {
    const read = readStories(
      reply(
        ['A', 'B', 'C'].map((title) => ({
          title,
          story: `Story ${title}`,
          prompts: prompts(4, title),
        }))
      ),
      BOTH
    )
    expect(read.stories.map((one) => one.title)).toEqual(['A', 'B', 'C'])
    expect(read.stories[2]).toEqual({
      title: 'C',
      story: 'Story C',
      prompts: prompts(4, 'C'),
    })
  })

  test(`${MAX_PROMPTS} prompts at most in all: the ones after are dropped`, () => {
    const read = readStories(
      reply([
        {title: 'A', prompts: prompts(8, 'A')},
        {title: 'B', prompts: prompts(8, 'B')},
        {title: 'C', prompts: prompts(2, 'C')},
      ]),
      ['prompts']
    )
    expect(read.stories.map((one) => one.prompts.length)).toEqual([8, 4])
  })

  test('only the parts asked are kept', () => {
    const answer = reply([{title: 'A', story: 'The story.', prompts: ['p']}])
    expect(readStories(answer, ['story']).stories).toEqual([
      {title: 'A', story: 'The story.', prompts: []},
    ])
    expect(readStories(answer, ['prompts']).stories).toEqual([
      {title: 'A', story: '', prompts: ['p']},
    ])
  })

  test('a JSON object inside a code block or words is read', () => {
    const answer = `Here it is:\n\`\`\`json\n${reply([
      {title: 'A', prompts: ['p']},
    ])}\n\`\`\`\nEnjoy!`
    expect(readStories(answer, ['prompts']).stories[0].prompts).toEqual(['p'])
  })

  test('an answer without what was asked is an error', () => {
    expect(() => readStories('I cannot help with that.', BOTH)).toThrow(
      'not in the format asked'
    )
    expect(() =>
      readStories(reply([{title: 'A', story: 'Only words.'}]), BOTH)
    ).toThrow('no image prompt')
    expect(() => readStories(reply([{title: 'A'}]), ['story'])).toThrow(
      'no story'
    )
    expect(() => readStories('{"stories": "none"}', ['story'])).toThrow(
      'not in the format asked'
    )
  })

  test('texts are trimmed, empty prompts and non-text values dropped', () => {
    const read = readStories(
      reply([{title: 7, story: '  S  ', prompts: [' p1 ', '', null, 3, 'p2']}]),
      BOTH
    )
    expect(read.stories[0]).toEqual({
      title: '',
      story: 'S',
      prompts: ['p1', 'p2'],
    })
  })
})
