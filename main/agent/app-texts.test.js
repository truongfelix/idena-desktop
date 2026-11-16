const {STORY_SUGGESTION, appTexts} = require('./app-texts')
const {storySystem} = require('./stories')
const {flipSystem, FLIP_SUGGESTION} = require('./flips')
const {SOCIAL_ACTIONS, SOCIAL_SUGGESTION, socialSystem} = require('./social')

// B-268: the ⓘ of each action shows what the app sends with the Instructions, built by the functions that send it.

describe("the app's part of each action, as the agent page shows it", () => {
  test('the texts sent without Instructions, for each action that has one', () => {
    const {sent} = appTexts()
    expect(sent.flipStory).toBe(storySystem(''))
    expect(sent.answerFlip).toBe(flipSystem(''))
    expect(sent.report).toBe(flipSystem(''))
    SOCIAL_ACTIONS.forEach((name) =>
      expect(sent[name]).toBe(socialSystem(SOCIAL_ACTIONS, ''))
    )
  })

  test("the suggestions: each says which task it is for, the story one without the app's part", () => {
    const {suggestions} = appTexts()
    expect(suggestions).toEqual({
      flipStory: STORY_SUGGESTION,
      answerFlip: FLIP_SUGGESTION,
      social: SOCIAL_SUGGESTION,
    })
    expect(STORY_SUGGESTION.split('\n')[0]).toBe('When you write a flip story:')
    expect(FLIP_SUGGESTION.split('\n')[0]).toMatch(/^When you solve a flip/u)
    expect(SOCIAL_SUGGESTION).toMatch(/^On Idena Social/u)
    expect(STORY_SUGGESTION).toContain('### Storytelling Rules')
    expect(STORY_SUGGESTION).not.toMatch(/\{KEYWORD|Output Format/u)
  })
})
