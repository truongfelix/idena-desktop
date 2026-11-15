// The agent's "Write flip stories" action (B-236): for a flip's two keywords, one story of 3 or 4 panels and one
// image prompt per panel, from the owner's templates (notes/agent-flip-story-template.md, approved 2026-11-13 and
// 2026-11-15). The templates are the app's part of the action; the agent's Instructions go in before their output
// format, as with the flips (flips.js), so whatever they say, the format the app reads comes last.

const TEMPLATE_3 = [
  'You are an expert visual storyteller specializing in simple, creative, three-panel stories for Idena Flip challenges.',
  '',
  'Your task is to create ONE three-panel story using the following two keywords, and then write three image-generation prompts (one per panel) that I can use to generate the images of the story.',
  '',
  '- Keyword 1: {KEYWORD_1}',
  '- Keyword 2: {KEYWORD_2}',
  '',
  '### Storytelling Rules',
  '',
  '1. Simple and immediately understandable: A 12-year-old should understand the whole story at a glance, without captions, dialogue, or written text.',
  '2. One main actor: Use one central character throughout the story.',
  '3. One clear goal: The main character has a simple, understandable objective.',
  '4. Logical sequence: The three panels form a coherent chain of actions with clear cause and effect.',
  '5. Both keywords are essential:',
  '   - Both keywords are visually prominent and central to the story.',
  '   - Both keywords actively contribute to the events.',
  '   - Neither keyword is decorative or randomly inserted.',
  '   - Removing either keyword would break the story.',
  '6. Three distinct panels: Each panel shows one significant, easily recognizable visual change.',
  '7. Clear progression:',
  '   - Panel 1 sets up the situation and the goal.',
  '   - Panel 2 shows the key action or turning point.',
  '   - Panel 3 shows the clear, satisfying result.',
  '   No unexplained jumps, repeated actions, or sudden resets.',
  '8. Visual storytelling only: No written words, signs, labels, numbers, speech bubbles, or text on screens or pages.',
  '9. Originality: Avoid predictable templates, especially stories that begin with a character waking up.',
  '10. No artificial tricks: No counting tricks, thumbs-up/thumbs-down gestures, or other arbitrary visual shortcuts to connect the keywords.',
  '',
  '### Image Prompt Rules',
  '',
  'Each of the three image prompts must:',
  '- Be self-contained (each prompt will be used separately, so repeat all needed details in every prompt).',
  '- Describe the main character identically in all three prompts (same species/age, clothing, colors, distinctive features) to keep visual consistency.',
  '- Keep the same art style, setting, lighting, and color palette across all three prompts.',
  '- Show both keywords clearly and recognizably whenever they appear in the panel.',
  '- Describe one clear action or state, with the character and keywords in the foreground and a simple, uncluttered background.',
  '- Explicitly state: "no text, no letters, no numbers, no signs, no speech bubbles, no watermark."',
  '- Specify a square format (1:1) composition.',
  '',
  '### Output Format',
  '',
  '**Story Title:** A short, descriptive title.',
  '',
  '**Main Character:** One-sentence description of the single central actor.',
  '',
  '**Goal:** What the character wants to achieve.',
  '',
  '**Story Summary:**',
  '- Panel 1: Initial situation and goal.',
  '- Panel 2: Key action or turning point.',
  '- Panel 3: Clear resolution.',
  '',
  '**Keyword Integration:** One sentence per keyword explaining why it is indispensable.',
  '',
  '**Image Prompt 1:** [full, standalone prompt]',
  '',
  '**Image Prompt 2:** [full, standalone prompt]',
  '',
  '**Image Prompt 3:** [full, standalone prompt]',
  '',
  '### Final Instructions',
  '',
  '- Generate exactly one story with exactly three panels.',
  '- Prioritize simplicity, creativity, visual clarity, and logical continuity.',
  '- Each image prompt should be 60–120 words, concrete and visual, with no storytelling commentary.',
  '- Do not generate the images yourself, and do not perform image verification, quality scoring, or publishing.',
].join('\n')

const TEMPLATE_4 = [
  'You are an expert visual storyteller specializing in simple, creative, four-panel stories for Idena Flip challenges.',
  '',
  'Your task is to create ONE four-panel story using the following two keywords, and then write four image-generation prompts (one per panel) that I can use to generate the images of the story.',
  '',
  '- Keyword 1: {KEYWORD_1}',
  '- Keyword 2: {KEYWORD_2}',
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
  '### Output Format',
  '',
  '**Story Title:** A short, descriptive title.',
  '',
  '**Main Character:** One-sentence description of the single central actor.',
  '',
  '**Goal:** What the character wants to achieve.',
  '',
  '**Story Summary:**',
  '- Panel 1: Initial situation and goal.',
  '- Panel 2: First action toward the goal.',
  '- Panel 3: Key turning point.',
  '- Panel 4: Clear resolution.',
  '',
  '**Keyword Integration:** One sentence per keyword explaining why it is indispensable.',
  '',
  '**Image Prompt 1:** [full, standalone prompt]',
  '',
  '**Image Prompt 2:** [full, standalone prompt]',
  '',
  '**Image Prompt 3:** [full, standalone prompt]',
  '',
  '**Image Prompt 4:** [full, standalone prompt]',
  '',
  '### Final Instructions',
  '',
  '- Generate exactly one story with exactly four panels.',
  '- Prioritize simplicity, creativity, visual clarity, and logical continuity.',
  '- Each image prompt should be 60–120 words, concrete and visual, with no storytelling commentary.',
  '- Do not generate the images yourself, and do not perform image verification, quality scoring, or publishing.',
].join('\n')

const MAX_KEYWORD_LENGTH = 200

/** The question's text for `panels` (3 or 4) and the flip's two keywords, with the agent's Instructions. */
function storySystem(panels, words, instructions = '') {
  if (panels !== 3 && panels !== 4) throw new Error('a story has 3 or 4 panels')
  if (
    !Array.isArray(words) ||
    words.length !== 2 ||
    !words.every(
      (w) =>
        w &&
        typeof w.name === 'string' &&
        w.name.trim() &&
        w.name.length <= MAX_KEYWORD_LENGTH &&
        (w.desc === undefined ||
          w.desc === null ||
          (typeof w.desc === 'string' && w.desc.length <= MAX_KEYWORD_LENGTH))
    )
  )
    throw new Error("a story needs the flip's two keywords")
  const keyword = ({name, desc}) =>
    desc && desc.trim() ? `${name.trim()} (${desc.trim()})` : name.trim()
  // A function as replacement: a "$&" in a keyword stays as it is.
  const text = (panels === 3 ? TEMPLATE_3 : TEMPLATE_4)
    .replace('{KEYWORD_1}', () => keyword(words[0]))
    .replace('{KEYWORD_2}', () => keyword(words[1]))
  const own = typeof instructions === 'string' ? instructions.trim() : ''
  if (!own) return text
  const at = text.indexOf('### Output Format')
  return `${text.slice(
    0,
    at
  )}### The instructions of the person who runs you, for this and every task\n\n${own}\n\n${text.slice(
    at
  )}`
}

const MAX_FIELD = 2000

/** The text after a bold label ("**Goal:** …") up to the next bold label or heading. */
function field(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(
    `\\*\\*${escaped}:?\\*\\*:?\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*\\n]+\\*\\*|\\n#{1,6} |$)`,
    'iu'
  ).exec(text)
  return match ? match[1].trim().slice(0, MAX_FIELD) : ''
}

/**
 * The model's answer read: the story's title, character, goal, its panels' summary, why each keyword matters, and one
 * prompt per panel. Throws when a prompt is missing: the person would get fewer pictures than panels.
 */
function readStory(text, panels) {
  const reply = String(text || '').slice(0, 64 * 1024)
  const summary = field(reply, 'Story Summary')
  const panelLines = Array.from({length: panels}, (_, i) => {
    const m = new RegExp(`Panel ${i + 1}:?\\s*(.+)`, 'iu').exec(summary)
    return m ? m[1].replace(/\*\*/gu, '').trim().slice(0, MAX_FIELD) : ''
  })
  const prompts = Array.from({length: panels}, (_, i) =>
    field(reply, `Image Prompt ${i + 1}`)
  )
  const missing = prompts.findIndex((p) => !p)
  if (missing >= 0)
    throw new Error(`the answer has no prompt for panel ${missing + 1}`)
  return {
    title: field(reply, 'Story Title'),
    character: field(reply, 'Main Character'),
    goal: field(reply, 'Goal'),
    panels: panelLines,
    keywords: field(reply, 'Keyword Integration'),
    prompts,
  }
}

module.exports = {TEMPLATE_3, TEMPLATE_4, readStory, storySystem}
