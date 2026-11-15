const {TEMPLATE_3, TEMPLATE_4, readStory, storySystem} = require('./stories')

const WORDS = [
  {name: 'ladder', desc: 'a set of steps'},
  {name: 'kite', desc: ''},
]

const answer = (panels) =>
  [
    '**Story Title:** The Kite in the Tree',
    '',
    '**Main Character:** A girl of about ten in a yellow raincoat with red boots.',
    '',
    '**Goal:** She wants her kite back from a tall oak.',
    '',
    '**Story Summary:**',
    ...Array.from(
      {length: panels},
      (_, i) => `- **Panel ${i + 1}:** Step ${i + 1} of the story.`
    ),
    '',
    '**Keyword Integration:**',
    '- Ladder: the only way up.',
    '- Kite: what she wants back.',
    '',
    ...Array.from({length: panels}, (_, i) => [
      `**Image Prompt ${i + 1}:** A girl in a yellow raincoat, panel ${
        i + 1
      }, a wooden ladder and a red kite, square 1:1, no text, no letters, no numbers, no signs, no speech bubbles, no watermark.`,
      '',
    ]).flat(),
  ].join('\n')

describe('flip stories (B-236)', () => {
  test("the owner's template, the keywords filled, for 3 and 4 panels", () => {
    const three = storySystem(3, WORDS)
    expect(three).toBe(
      TEMPLATE_3.replace('{KEYWORD_1}', 'ladder (a set of steps)').replace(
        '{KEYWORD_2}',
        'kite'
      )
    )
    expect(storySystem(4, WORDS)).toContain('ONE four-panel story')
    expect(TEMPLATE_4).toContain('**Image Prompt 4:**')
    expect(three).not.toContain('{KEYWORD')
  })

  test("the agent's Instructions go in before the output format, which stays last", () => {
    const sent = storySystem(3, WORDS, 'Draw everything as a watercolour.')
    const own = sent.indexOf('Draw everything as a watercolour.')
    expect(own).toBeGreaterThan(sent.indexOf('### Image Prompt Rules'))
    expect(own).toBeLessThan(sent.indexOf('### Output Format'))
    expect(
      sent.endsWith(TEMPLATE_3.slice(TEMPLATE_3.indexOf('### Output Format')))
    ).toBe(true)
  })

  test('a keyword is put in as it is, even with $ signs', () => {
    expect(
      storySystem(3, [{name: '$&'}, {name: "$'x"}]).match(/Keyword \d: .*/gu)
    ).toEqual(['Keyword 1: $&', "Keyword 2: $'x"])
  })

  test('without two keywords, or another count of panels, nothing is asked', () => {
    expect(() => storySystem(5, WORDS)).toThrow('3 or 4 panels')
    expect(() => storySystem(3, [WORDS[0]])).toThrow('two keywords')
    expect(() => storySystem(3, [WORDS[0], {name: ' '}])).toThrow(
      'two keywords'
    )
  })

  test('the answer read: title, character, goal, each panel and one prompt per panel', () => {
    for (const panels of [3, 4]) {
      const story = readStory(answer(panels), panels)
      expect(story.title).toBe('The Kite in the Tree')
      expect(story.character).toMatch(/^A girl of about ten/u)
      expect(story.goal).toBe('She wants her kite back from a tall oak.')
      expect(story.panels).toEqual(
        Array.from({length: panels}, (_, i) => `Step ${i + 1} of the story.`)
      )
      expect(story.keywords).toContain('Ladder: the only way up.')
      expect(story.prompts).toHaveLength(panels)
      story.prompts.forEach((p, i) => {
        expect(p).toMatch(
          new RegExp(`^A girl in a yellow raincoat, panel ${i + 1},`, 'u')
        )
        expect(p).not.toContain('**')
      })
    }
  })

  test('labels written with the colon after the bold are read too', () => {
    const text = answer(3)
      .replace('**Story Title:**', '**Story Title**:')
      .replace('**Image Prompt 3:**', '**Image Prompt 3**:')
    const story = readStory(text, 3)
    expect(story.title).toBe('The Kite in the Tree')
    expect(story.prompts[2]).toMatch(/panel 3/u)
  })

  test('an answer missing a prompt is refused, naming the panel', () => {
    expect(() => readStory(answer(3), 4)).toThrow('no prompt for panel 4')
    expect(() => readStory('I cannot help with that.', 3)).toThrow(
      'no prompt for panel 1'
    )
  })
})
