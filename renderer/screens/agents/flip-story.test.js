import {
  draftStory,
  fitContain,
  freeSlots,
  promptsOf,
  storyAgentOf,
  storyForKeywords,
  storyWords,
  withPrompt,
} from './flip-story'

// B-236: the flip editor shows the story panel only for an agent that is on and holds "Write flip stories".

const agent = (more) => ({
  id: 'a',
  name: 'A',
  enabled: true,
  actions: {flipStory: {level: 'ask'}},
  ...more,
})

describe('who writes the flip stories', () => {
  test('an agent that is on with the action, Ask me or Alone', () => {
    expect(storyAgentOf({paused: false, agents: [agent()]}).id).toBe('a')
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({actions: {flipStory: {level: 'alone'}}})],
      }).id
    ).toBe('a')
  })

  test('nobody: no agent, the action Off or absent, the agent off, all paused', () => {
    expect(storyAgentOf(null)).toBeNull()
    expect(storyAgentOf({paused: false, agents: []})).toBeNull()
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({actions: {flipStory: {level: 'off'}}})],
      })
    ).toBeNull()
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({actions: {answerFlip: {level: 'ask'}}})],
      })
    ).toBeNull()
    expect(
      storyAgentOf({paused: false, agents: [agent({enabled: false})]})
    ).toBeNull()
    expect(storyAgentOf({paused: true, agents: [agent()]})).toBeNull()
  })

  test('the first agent holding it, past one that does not', () => {
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({id: 'x', actions: {}}), agent({id: 'y'})],
      }).id
    ).toBe('y')
  })
})

describe("the flip's keywords as the agent gets them", () => {
  test('the two English words, their descriptions', () => {
    expect(
      storyWords({
        words: [
          {id: 1, name: 'ladder', desc: 'a set of steps'},
          {id: 2, name: 'kite', desc: null},
        ],
      })
    ).toEqual([
      {name: 'ladder', desc: 'a set of steps'},
      {name: 'kite', desc: ''},
    ])
  })

  test('missing keywords: none', () => {
    expect(storyWords({words: []})).toBeNull()
    expect(storyWords({words: [{name: 'ladder'}]})).toBeNull()
    expect(storyWords(undefined)).toBeNull()
  })
})

describe('Make the images: which slots, and the picture in the frame', () => {
  test("every slot but the nonsense picture's, with its place in the editor's order", () => {
    expect(freeSlots([2, 0, 3, 1], 3)).toEqual([
      {slot: 2, place: 0},
      {slot: 0, place: 1},
      {slot: 1, place: 3},
    ])
    // Unlocked (no nonsense picture): all four.
    expect(freeSlots([2, 0, 3, 1], -1).map(({slot}) => slot)).toEqual([
      2, 0, 3, 1,
    ])
    expect(freeSlots(undefined, 3)).toEqual([])
  })

  test('a square picture whole and centred in the 440 x 330 frame', () => {
    expect(fitContain(1024, 1024, 440, 330)).toEqual({
      x: 55,
      y: 0,
      width: 330,
      height: 330,
    })
    expect(fitContain(1536, 1024, 440, 330)).toEqual({
      x: 0,
      y: 18,
      width: 440,
      height: 293,
    })
  })
})

describe("the draft's stories for these keywords (B-236, B-268)", () => {
  const words = [{name: 'ladder'}, {name: 'kite'}]
  const run = {
    stories: [
      {title: 'A', story: 'Story A', prompts: ['a1', 'a2']},
      {title: 'B', story: '', prompts: ['b1']},
    ],
  }
  const saved = draftStory(run, words, {
    idea: 'windy',
    parts: ['story', 'prompts'],
    titles: ['Before'],
  })

  test('kept with its keywords, the idea, the parts and every title so far', () => {
    expect(saved).toEqual({
      words: ['ladder', 'kite'],
      idea: 'windy',
      parts: ['story', 'prompts'],
      titles: ['Before', 'A', 'B'],
      stories: run.stories,
    })
    expect(storyForKeywords(saved, words)).toEqual(saved)
  })

  test('none for other keywords, without one, or for a draft without stories', () => {
    expect(
      storyForKeywords(saved, [{name: 'ladder'}, {name: 'boat'}])
    ).toBeNull()
    expect(storyForKeywords(null, words)).toBeNull()
    expect(storyForKeywords({...saved, words: undefined}, words)).toBeNull()
    expect(storyForKeywords({...saved, stories: []}, words)).toBeNull()
  })

  test('a draft of a build before B-268 is read as one story', () => {
    const old = {
      words: ['ladder', 'kite'],
      title: 'T',
      character: 'a boy',
      panels: ['one', 'two', 'three'],
      prompts: ['p1', 'p2', 'p3'],
    }
    expect(storyForKeywords(old, words)).toEqual({
      words: ['ladder', 'kite'],
      idea: '',
      parts: ['story', 'prompts'],
      titles: ['T'],
      stories: [
        {title: 'T', story: 'one\ntwo\nthree', prompts: ['p1', 'p2', 'p3']},
      ],
    })
    expect(storyForKeywords({...old, prompts: []}, words)).toBeNull()
  })

  test('a prompt edited changes that prompt only; the prompts listed in order', () => {
    const edited = withPrompt(saved, 0, 1, 'a2, at night')
    expect(edited.stories[0].prompts).toEqual(['a1', 'a2, at night'])
    expect(edited.stories[1]).toBe(saved.stories[1])
    expect(promptsOf(edited)).toEqual([
      {story: 0, index: 0, prompt: 'a1'},
      {story: 0, index: 1, prompt: 'a2, at night'},
      {story: 1, index: 0, prompt: 'b1'},
    ])
    expect(promptsOf(null)).toEqual([])
  })

  test('a long description is cut for the agent, not refused', () => {
    const [first] = storyWords({
      words: [
        {name: 'ladder', desc: 'x'.repeat(500)},
        {name: 'kite', desc: ''},
      ],
    })
    expect(first.desc).toHaveLength(200)
  })
})
