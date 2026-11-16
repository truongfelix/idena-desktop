// The app's part of a question, unlocked (B-282, owner 2026-11-16; ruling Q-62 as changed that day): for each area an
// agent may hold its own text in place of the app's, edited by the person after a warning. The default stays the
// app's, written by the functions that always sent it (stories.js, flips.js, social.js); an agent holds a text only
// for an area it changed, so one area's text never changes another's and an older build reads the defaults.

/** The areas with a part of their own: the flip stories, the validation's question (answers, reports, the judge), Social. */
const PARTS = ['flipStory', 'validation', 'social']
const MAX_PART_LENGTH = 20000

/** Where the person's Instructions go in a part, and, on Social, the actions the agent holds. */
const INSTRUCTIONS_SLOT = '{{instructions}}'
const ACTIONS_SLOT = '{{actions}}'

/**
 * An unlocked part as sent: each slot filled. A text without the Instructions' slot gets them at its end, so they
 * are never dropped.
 */
function fillPart(template, {instructions = '', actions = ''} = {}) {
  const own = typeof instructions === 'string' ? instructions.trim() : ''
  const text = String(template).split(ACTIONS_SLOT).join(actions)
  if (text.includes(INSTRUCTIONS_SLOT))
    return text.split(INSTRUCTIONS_SLOT).join(own)
  return own ? `${text}\n\n${own}` : text
}

/**
 * The parts an agent changed, each checked: a text of its own for an area, kept only when it is not the app's
 * (`defaults`: the app's parts with their slots). None changed: an empty object.
 */
function normalizeParts(value, defaults) {
  const saved = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    PARTS.filter(
      (name) =>
        typeof saved[name] === 'string' &&
        saved[name].trim() &&
        saved[name].length <= MAX_PART_LENGTH &&
        saved[name].trim() !== defaults[name].trim()
    ).map((name) => [name, saved[name]])
  )
}

module.exports = {
  ACTIONS_SLOT,
  INSTRUCTIONS_SLOT,
  MAX_PART_LENGTH,
  PARTS,
  fillPart,
  normalizeParts,
}
