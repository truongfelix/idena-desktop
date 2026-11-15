import {
  draftStory,
  fitContain,
  storyAgentOf,
  storyForKeywords,
  storySlots,
  storyWords,
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
  test("every slot but the nonsense picture's, in the editor's order", () => {
    expect(storySlots([2, 0, 3, 1], 3, 3)).toEqual([2, 0, 1])
    // Unlocked (no nonsense picture): four slots for four pictures.
    expect(storySlots([2, 0, 3, 1], -1, 4)).toEqual([2, 0, 3, 1])
    // Three pictures with the slot unlocked: the first three, the fourth left to the person.
    expect(storySlots([0, 1, 2, 3], -1, 3)).toEqual([0, 1, 2])
  })

  test('four pictures while the nonsense slot is locked: none', () => {
    expect(storySlots([0, 1, 2, 3], 3, 4)).toBeNull()
    expect(storySlots(undefined, 3, 3)).toBeNull()
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

describe("the draft's story for these keywords (B-236)", () => {
  const words = [{name: 'ladder'}, {name: 'kite'}]
  const saved = draftStory({title: 'T', prompts: ['a', 'b', 'c']}, words)

  test('kept with its keywords, shown again for them', () => {
    expect(saved.words).toEqual(['ladder', 'kite'])
    expect(storyForKeywords(saved, words)).toBe(saved)
  })

  test('none for other keywords, without one, or for a draft that has none', () => {
    expect(
      storyForKeywords(saved, [{name: 'ladder'}, {name: 'boat'}])
    ).toBeNull()
    expect(storyForKeywords(null, words)).toBeNull()
    expect(storyForKeywords({title: 'T', prompts: ['a']}, words)).toBeNull()
    expect(
      storyForKeywords({words: ['ladder', 'kite'], prompts: []}, words)
    ).toBeNull()
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
