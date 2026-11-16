const {STORY_SUGGESTION, appTexts} = require('./app-texts')
const {storySystem} = require('./stories')
const {flipSystem, FLIP_SUGGESTION} = require('./flips')
const {SOCIAL_ACTIONS, SOCIAL_SUGGESTION, socialSystem} = require('./social')

// B-268: the ⓘ of each action shows what the app sends with the Instructions, built by the functions that send it.

describe("the app's part of each action, as the agent page shows it", () => {
  test('the system text sent without Instructions, then the question with its labels', () => {
    const {sent} = appTexts()
    expect(sent.flipStory.startsWith(`${storySystem('')}\n\n`)).toBe(true)
    expect(sent.flipStory).toContain("The flip's two keywords:")
    expect(sent.flipStory).toContain('The idea of the person for this story:')
    expect(sent.flipStory).toContain('Stories given before, not to give again:')
    expect(sent.answerFlip.startsWith(`${flipSystem('')}\n\n`)).toBe(true)
    expect(sent.answerFlip).toContain('LEFT order, pictures 1 to 4:')
    expect(sent.answerFlip).toContain('Your JSON answer:')
    expect(sent.report).toBe(sent.answerFlip)
    SOCIAL_ACTIONS.forEach((name) =>
      expect(sent[name].startsWith(socialSystem(SOCIAL_ACTIONS, ''))).toBe(true)
    )
  })

  test('Social lists only the actions the agent holds', () => {
    const {sent} = appTexts({held: ['like']})
    expect(sent.like.startsWith(socialSystem(['like'], ''))).toBe(true)
    expect(sent.like).toContain('"do": "like"')
    expect(sent.like).not.toContain('"do": "tip"')
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
