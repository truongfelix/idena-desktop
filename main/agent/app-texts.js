// What the app adds to the Instructions for each action (B-268, owner 2026-11-16), as the agent's page shows it in the
// action's ⓘ, and the suggested Instructions it offers: the texts are built by the same functions that send them.

const {storyQuestion, storySystem} = require('./stories')
const {FLIP_SUGGESTION, flipQuestion, flipSystem} = require('./flips')
const {
  SOCIAL_ACTIONS,
  SOCIAL_SUGGESTION,
  socialHeld,
  socialSystem,
  socialTemplate,
} = require('./social')
const {INSTRUCTIONS_SLOT} = require('./app-parts')

/**
 * The owner's story template of 2026-11-13 and 2026-11-15 (four panels), as a suggestion for the Instructions: its
 * rules only (the keywords and the format are the app's part). One Instructions text goes with every action, so it
 * says which task it is for.
 */
const STORY_SUGGESTION = [
  'When you write a flip story:',
  '',
  'By default, ONE four-panel story, and four image-generation prompts (one per panel), for the two keywords the app gives.',
  '',
  '### Storytelling Rules',
  '',
  '1. Simple and immediately understandable: A 12-year-old should understand the whole story at a glance, without captions, dialogue, or written text.',
  '2. One main actor: Use one central character throughout the story.',
  '3. One clear goal: The main character has a simple, understandable objective.',
  '4. Logical sequence: The four panels form a coherent chain of actions with clear cause and effect, so that only one order of the panels makes sense.',
  '5. Both keywords are essential:',
  '   - Both keywords are visually prominent and central to the story.',
  '   - Both keywords actively contribute to the events.',
  '   - Neither keyword is decorative or randomly inserted.',
  '   - Removing either keyword would break the story.',
  '6. Four distinct panels: Each panel shows one significant, easily recognizable visual change from the panel before it.',
  '7. Clear progression:',
  '   - Panel 1 sets up the situation and the goal.',
  '   - Panel 2 shows the first action toward the goal.',
  '   - Panel 3 shows the key turning point: a complication, a discovery, or the decisive action.',
  '   - Panel 4 shows the clear, satisfying result.',
  '   No unexplained jumps, repeated actions, or sudden resets.',
  '8. Visual storytelling only: No written words, signs, labels, numbers, speech bubbles, or text on screens or pages.',
  '9. Originality: Avoid predictable templates, especially stories that begin with a character waking up.',
  '10. No artificial tricks: No counting tricks, thumbs-up/thumbs-down gestures, or other arbitrary visual shortcuts to connect the keywords.',
  '',
  '### Image Prompt Rules',
  '',
  'Each of the four image prompts must:',
  '- Be self-contained (each prompt will be used separately, so repeat all needed details in every prompt).',
  '- Describe the main character identically in all four prompts (same species/age, clothing, colors, distinctive features) to keep visual consistency.',
  '- Keep the same art style, setting, lighting, and color palette across all four prompts.',
  '- Show both keywords clearly and recognizably whenever they appear in the panel.',
  '- Describe one clear action or state, with the character and keywords in the foreground and a simple, uncluttered background.',
  '- Explicitly state: "no text, no letters, no numbers, no signs, no speech bubbles, no watermark."',
  '- Specify a square format (1:1) composition.',
  '',
  '- Each image prompt should be 60–120 words, concrete and visual, with no storytelling commentary.',
].join('\n')

const QUESTION = '--- The question ---'

/** A story run's question as the app writes it, with stand-ins for the person's data. */
const storyExample = () =>
  storyQuestion({
    words: [{name: '(keyword 1)'}, {name: '(keyword 2)'}],
    idea: '(your idea, when you write one)',
    parts: ['story', 'prompts'],
    notThese: ['(the titles given before, for Try another story)'],
  })

/** A flip's question as the app writes it, its pictures named. */
function flipExample() {
  const picture = {mediaType: 'image/png', data: ''}
  const {parts} = flipQuestion({
    images: [picture, picture, picture, picture],
    orders: [
      [0, 1, 2, 3],
      [0, 1, 2, 3],
    ],
    words: [{name: '(keyword 1)'}, {name: '(keyword 2)'}],
  })
  return parts
    .map((part) => (part.type === 'image' ? '(a picture)' : part.text))
    .join('\n')
}

/**
 * The app's part of each area with its slots (B-282, app-parts.js): what the agent's page shows locked, and what an
 * unlocked text starts from.
 */
const defaultParts = () => ({
  flipStory: storySystem(INSTRUCTIONS_SLOT),
  validation: flipSystem(INSTRUCTIONS_SLOT),
  social: socialTemplate(),
})

/**
 * Each action's app part as sent without Instructions (the system text, then the question with stand-ins for the
 * data), and the suggestions: the ⓘ and the Instructions' "Add the suggestion". `held`: the Social actions the agent
 * holds, as its run lists them.
 */
function appTexts({held = SOCIAL_ACTIONS} = {}) {
  const flips = `${flipSystem('')}\n\n${QUESTION}\n${flipExample()}`
  const social = `${socialSystem(
    socialHeld(held),
    ''
  )}\n\n${QUESTION}\n(what the app read on Social since the last run, labelled p1, c1, u1)`
  return {
    sent: {
      flipStory: `${storySystem('')}\n\n${QUESTION}\n${storyExample()}`,
      answerFlip: flips,
      report: flips,
      // A draft judged as a validator would (B-258): the validation's question.
      flipJudge: flips,
      // A picture is drawn from its prompt alone: the service gets nothing else.
      flipPictures: `${QUESTION}\n(one image prompt of the story)`,
      ...Object.fromEntries(SOCIAL_ACTIONS.map((name) => [name, social])),
    },
    suggestions: {
      flipStory: STORY_SUGGESTION,
      answerFlip: FLIP_SUGGESTION,
      social: SOCIAL_SUGGESTION,
    },
    parts: defaultParts(),
  }
}

module.exports = {STORY_SUGGESTION, appTexts, defaultParts}
