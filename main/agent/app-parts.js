// The app's part of a question, unlocked (B-282, owner 2026-11-16; ruling Q-62 as changed that day): for each area an
// agent may hold its own text in place of the app's, edited by the person after a warning. The default stays the
// app's, written by the functions that always sent it (stories.js, flips.js, social.js); an agent holds a text only
// for an area it changed, so one area's text never changes another's and an older build reads the defaults. An
// agent that changed none is asked by those functions as before, word for word.

/**
 * The areas (the flip stories, the validation's question for answers, reports and the judge, Social), each with its
 * texts. The first, named as its area, is the area's system text (B-282). The others (B-285, owner 2026-11-17,
 * ruling Q-66: "Everything send in the api should be known and can be editable") are the words the app writes
 * around the data: the story's and the flip's question, the picture's request, Social's action lines and what a run
 * reads. An agent holds one only when it changed it, as for the system texts.
 */
const AREAS = {
  flipStory: ['flipStory', 'storyQuestion', 'imagePrompt', 'imageSize'],
  validation: ['validation', 'flipQuestion', 'flipQuestionShort'],
  social: ['social', 'socialActions', 'socialDigest', 'socialLines'],
}
const PARTS = Object.values(AREAS).flat()
const MAX_PART_LENGTH = 20000
/**
 * The longest of the shorter texts. What a Social run reads is cut at 15,000 characters of items and sent within
 * 20,000: its layout stays well below the difference.
 */
const MAX_LENGTHS = {
  imagePrompt: 2000,
  imageSize: 20,
  socialActions: 4000,
  socialDigest: 2000,
  socialLines: 4000,
}
const maxLength = (name) => MAX_LENGTHS[name] || MAX_PART_LENGTH

/** Where the person's Instructions go in a part, and, on Social, the actions the agent holds. */
const INSTRUCTIONS_SLOT = '{{instructions}}'
const ACTIONS_SLOT = '{{actions}}'

/**
 * An unlocked part as sent: each slot filled. A text without a slot gets what the slot holds at its end (the
 * actions, then the Instructions), so neither is ever dropped. An agent without Instructions: the slot's line goes,
 * with the line that announces it (one ending with ":"), so what follows is not read as the person's words.
 */
function fillPart(template, {instructions = '', actions = ''} = {}) {
  const own = typeof instructions === 'string' ? instructions.trim() : ''
  let text = String(template)
  const listsActions = text.includes(ACTIONS_SLOT)
  text = text.split(ACTIONS_SLOT).join(actions)
  if (!listsActions && actions) text = `${text}\n\n${actions}`
  if (!text.includes(INSTRUCTIONS_SLOT)) return own ? `${text}\n\n${own}` : text
  if (own) return text.split(INSTRUCTIONS_SLOT).join(own)
  const kept = []
  text.split('\n').forEach((line) => {
    if (line.trim() !== INSTRUCTIONS_SLOT) {
      kept.push(line.split(INSTRUCTIONS_SLOT).join(''))
      return
    }
    if (kept.length && kept[kept.length - 1].trim().endsWith(':')) kept.pop()
  })
  return kept.join('\n').replace(/^\n+/u, '')
}

const SLOT = /\{\{([A-Za-z0-9]+)\}\}/gu

/**
 * A text with its slots filled (B-285): each "{{name}}" of `values` replaced in one pass, so a value that holds a
 * "{{...}}" of its own (a keyword, a post: other people's words) is never filled in turn. A slot the text does not
 * know stays as written. A paragraph whose slots all hold nothing is left out (no idea for the story, no tip since
 * the last run), unless `drop` is false. A `required` value the text has no slot for goes at its end, a paragraph
 * each: the data a question cannot do without is never dropped by an edit.
 */
function fillSlots(template, values = {}, {required = [], drop = true} = {}) {
  const has = (name) => Object.prototype.hasOwnProperty.call(values, name)
  const valueOf = (name) =>
    values[name] === null || values[name] === undefined
      ? ''
      : String(values[name])
  const source = String(template)
  const fill = (text) =>
    text.replace(SLOT, (slot, name) => (has(name) ? valueOf(name) : slot))
  const used = new Set()
  source.replace(SLOT, (slot, name) => used.add(name))
  const filled = drop
    ? source
        .split(/\n{2,}/u)
        .filter((paragraph) => {
          const slots = [...paragraph.matchAll(SLOT)]
            .map(([, name]) => name)
            .filter(has)
          return !slots.length || slots.some((name) => valueOf(name) !== '')
        })
        .map(fill)
        .join('\n\n')
    : fill(source)
  const missing = required
    .filter((name) => !used.has(name) && valueOf(name) !== '')
    .map(valueOf)
  return [filled, ...missing].filter((text) => text !== '').join('\n\n')
}

/**
 * A text of named lines, "name: the line" (B-285: Social's action lines, the lines of what a run reads), read: the
 * line of each name in `names` that the text holds, the first one. One space after the colon is the separator; what
 * follows is the line as written, its own leading spaces kept. A name the text lacks is absent: the app's line stays.
 */
function namedLines(text, names) {
  const lines = {}
  String(text || '')
    .split('\n')
    .forEach((line) => {
      const at = line.indexOf(':')
      if (at < 1) return
      const name = line.slice(0, at).trim()
      if (!names.includes(name) || name in lines) return
      const rest = line.slice(at + 1)
      lines[name] = rest.startsWith(' ') ? rest.slice(1) : rest
    })
  return lines
}

/** Named lines as the text that holds them, in the order of `lines`. */
const namedText = (lines) =>
  Object.entries(lines)
    .map(([name, line]) => `${name}: ${line}`)
    .join('\n')

/**
 * The parts an agent changed, each checked: a text of its own for an area, kept only when it is not the app's
 * (`defaults`: the app's parts with their slots). None changed: an empty object.
 */
function normalizeParts(value, defaults) {
  const saved = value && typeof value === 'object' ? value : {}
  // A text past the longest is cut there (the page's editor cannot write one; a file edited by hand can): the
  // person's text is never replaced by the app's unsaid.
  return Object.fromEntries(
    PARTS.filter(
      (name) =>
        typeof saved[name] === 'string' &&
        saved[name].trim() &&
        saved[name].trim() !== defaults[name].trim()
    ).map((name) => [name, saved[name].slice(0, maxLength(name))])
  )
}

module.exports = {
  ACTIONS_SLOT,
  AREAS,
  INSTRUCTIONS_SLOT,
  MAX_PART_LENGTH,
  PARTS,
  fillPart,
  fillSlots,
  maxLength,
  namedLines,
  namedText,
  normalizeParts,
}
