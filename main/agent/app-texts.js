// What the app adds to the Instructions for each action (B-268, owner 2026-11-16), as the agent's page shows it in the
// action's ⓘ, and the suggested Instructions it offers: the texts are built by the same functions that send them.

const {storySystem} = require('./stories')
const {FLIP_SUGGESTION, flipSystem} = require('./flips')
const {SOCIAL_ACTIONS, SOCIAL_SUGGESTION, socialSystem} = require('./social')

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

/** Each action's app part (without Instructions) and suggestion: the ⓘ and the Instructions' "Add the suggestion". */
function appTexts() {
  const flips = flipSystem('')
  const social = socialSystem(SOCIAL_ACTIONS, '')
  return {
    sent: {
      flipStory: storySystem(''),
      answerFlip: flips,
      report: flips,
      ...Object.fromEntries(SOCIAL_ACTIONS.map((name) => [name, social])),
    },
    suggestions: {
      flipStory: STORY_SUGGESTION,
      answerFlip: FLIP_SUGGESTION,
      social: SOCIAL_SUGGESTION,
    },
  }
}

module.exports = {STORY_SUGGESTION, appTexts}
