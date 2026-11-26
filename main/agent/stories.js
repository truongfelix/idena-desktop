// The agent's "Write flip stories" action (B-236, B-268): for a flip's two keywords, the stories and image prompts the
// person's Instructions ask for. Nothing of the app's tells the model how to write them (owner 2026-11-16, ruling
// Q-62 changed): the model gets the Instructions, the action's data (the keywords, the person's idea for this story,
// the parts asked, the stories given before) and the answer's format, which the app reads. The format comes last, so
// whatever the Instructions say, it is the one the app reads.

const {firstJsonObject} = require('./flips')
const {fillPart, fillSlots} = require('./app-parts')

const MAX_KEYWORD_LENGTH = 200
const MAX_IDEA_LENGTH = 2000
/** The prompts of one answer at most, all its stories together: "3 stories of 4 pictures" fits. */
const MAX_PROMPTS = 12
/** The prompts of a story when the Instructions give no number: one for each picture of a flip. */
const DEFAULT_PROMPTS = 4
const MAX_FIELD = 2000
const MAX_STORY = 4000
/** The earlier stories' titles sent as "not these", the latest ones. */
const MAX_NOT_THESE = 10

/** What a story run can give: the stories told in words, the image prompts (the pictures are drawn from those). */
const PARTS = ['story', 'prompts']

/** The answer's format: the app's whole part of the system text. */
const FORMAT = [
  'Answer with one JSON object and nothing else:',
  '{"stories": [{"title": "a short title", "story": "the story told in words", "prompts": ["one image prompt per picture", "..."]}]}',
  `"story" only when the story is asked, "prompts" only when the prompts are asked; ${MAX_PROMPTS} prompts at most in all the stories.`,
  // What is asked without a word of the person's on it (owner 2026-11-17, B-283): a flip's four pictures.
  `Unless the instructions above ask for another number: one story, with ${DEFAULT_PROMPTS} image prompts.`,
].join('\n')

/**
 * The system text: the agent's Instructions when it has some, then the format. `custom`: the agent's own part for
 * the flip stories (B-282, app-parts.js), sent in place of it.
 */
function storySystem(instructions = '', custom = null) {
  if (custom) return fillPart(custom, {instructions})
  const own = typeof instructions === 'string' ? instructions.trim() : ''
  return own ? `${own}\n\n${FORMAT}` : FORMAT
}

function checkWords(words) {
  if (
    !Array.isArray(words) ||
    words.length !== 2 ||
    !words.every(
      (w) =>
        w &&
        typeof w.name === 'string' &&
        w.name.trim() &&
        w.name.length <= MAX_KEYWORD_LENGTH &&
        (w.desc === undefined || w.desc === null || typeof w.desc === 'string')
    )
  )
    throw new Error("a story needs the flip's two keywords")
}

/** The parts asked, in the format's order; at least one. */
function checkParts(parts) {
  const asked = PARTS.filter(
    (part) => Array.isArray(parts) && parts.includes(part)
  )
  if (!asked.length)
    throw new Error('a story run asks for the story, the prompts or both')
  return asked
}

/**
 * The question's words around its data, with a slot for each (B-285): what an unlocked text starts from. Filled, it
 * is the question below; `asked` is "the story", "the image prompts" or both, `before` one title a line.
 */
const QUESTION = [
  "The flip's two keywords:",
  '1. {{keyword1}}',
  '2. {{keyword2}}',
  '',
  'The idea of the person for this story:',
  '{{idea}}',
  '',
  'Asked: {{asked}}.',
  '',
  'Stories given before, not to give again:',
  '{{before}}',
].join('\n')

/**
 * The question: the flip's keywords (a description cut, never refused: a long community one must not stop the story),
 * the person's idea for this story, the parts asked and the titles of the stories given before ("Try another story").
 * `custom`: the agent's own words for it (B-285), its slots filled with the same data.
 */
function storyQuestion(
  {words, idea = '', parts, notThese = []} = {},
  custom = null
) {
  checkWords(words)
  const asked = checkParts(parts)
  const keyword = ({name, desc}) => {
    const about = (desc || '').trim().slice(0, MAX_KEYWORD_LENGTH)
    return about ? `${name.trim()} (${about})` : name.trim()
  }
  const own =
    typeof idea === 'string' ? idea.trim().slice(0, MAX_IDEA_LENGTH) : ''
  const before = (Array.isArray(notThese) ? notThese : [])
    .filter((title) => typeof title === 'string' && title.trim())
    .slice(-MAX_NOT_THESE)
    .map((title) => title.trim().slice(0, MAX_FIELD))
  const what = asked
    .map((part) => (part === 'story' ? 'the story' : 'the image prompts'))
    .join(' and ')
  if (custom)
    return fillSlots(
      custom,
      {
        keyword1: keyword(words[0]),
        keyword2: keyword(words[1]),
        idea: own,
        asked: what,
        before: before.map((title) => `- ${title}`).join('\n'),
      },
      {required: ['keyword1', 'keyword2']}
    )
  return [
    "The flip's two keywords:",
    `1. ${keyword(words[0])}`,
    `2. ${keyword(words[1])}`,
    ...(own ? ['', 'The idea of the person for this story:', own] : []),
    '',
    `Asked: ${what}.`,
    ...(before.length
      ? [
          '',
          'Stories given before, not to give again:',
          ...before.map((title) => `- ${title}`),
        ]
      : []),
  ].join('\n')
}

const cut = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * The model's answer read: its stories, each with its title, its story in words (when asked) and its prompts (when
 * asked), MAX_PROMPTS prompts at most in all (the ones after are dropped). Throws when the parts asked are not there:
 * the person would get nothing to use.
 */
function readStories(text, parts) {
  const asked = checkParts(parts)
  const answer = firstJsonObject(String(text || '').slice(0, 64 * 1024))
  if (!answer || !Array.isArray(answer.stories))
    throw new Error('the answer is not in the format asked')
  let left = asked.includes('prompts') ? MAX_PROMPTS : 0
  const stories = answer.stories
    .filter((one) => one && typeof one === 'object')
    .map((one) => {
      const prompts = (Array.isArray(one.prompts) ? one.prompts : [])
        .map((prompt) => cut(prompt, MAX_FIELD))
        .filter(Boolean)
        .slice(0, left)
      left -= prompts.length
      return {
        title: cut(one.title, MAX_FIELD),
        story: asked.includes('story') ? cut(one.story, MAX_STORY) : '',
        prompts,
      }
    })
    .filter((one) => one.story || one.prompts.length)
  if (asked.includes('prompts') && !stories.some((one) => one.prompts.length))
    throw new Error('the answer has no image prompt')
  if (!stories.length) throw new Error('the answer has no story')
  return {stories}
}

module.exports = {
  FORMAT,
  MAX_PROMPTS,
  PARTS,
  STORY_QUESTION: QUESTION,
  readStories,
  storyQuestion,
  storySystem,
}
