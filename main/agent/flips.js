// The agent's validation tool: one flip to the model, its answer read back. A flip is four pictures and two orders
// of them; one order tells a story, the other does not. In the long session the model also says whether the story
// shows its two keywords, and why it should be reported: one or more of the nine report reasons of the validation
// screen, each with the model's confidence; a flip is reported when one reason reaches that reason's threshold.

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
/** A rule break the model is this sure of, even below its threshold, keeps a flip from being marked best. */
const DOUBT = 0.5
const MAX_WORD_LENGTH = 200

/**
 * The report reasons, numbered as the validation screen's (the practice flips' reportReason, B-195), as the model reads
 * them.
 */
const REPORT_REASONS = {
  1: 'a keyword is not clearly shown in the pictures',
  2: 'numbers or letters on the pictures give the order',
  3: 'a sequence of enumerated objects (a list of things in a row) instead of a story',
  4: 'text on the pictures must be read to solve the flip',
  5: 'adult content (NSFW)',
  6: 'several unrelated stories',
  7: 'the waking-up template (someone wakes up, then the story)',
  8: 'a thumbs up or thumbs down picture at the end',
  9: 'pictures of both keywords inserted into a page, screen or painting',
}

/**
 * The confidence each reason needs for a report by default; the person sets each on the validation agent's page
 * (settings.js reportThresholds), as they depend on the model. The practice runs of 2026-11-12 (9 long flips): at
 * 0.7, Opus reported the four flips to report and no good flip; Sonnet gave a good flip 0.85 on reason 1. Reasons
 * 5 to 9 never came up there: they keep the template's "very sure".
 */
const REPORT_THRESHOLDS = {
  1: 0.7,
  2: 0.7,
  3: 0.7,
  4: 0.7,
  5: 0.9,
  6: 0.9,
  7: 0.9,
  8: 0.9,
  9: 0.9,
}

// The app's part of the question for a flip (B-235, B-268): what the answer means (the two orders, the keywords), the
// nine report reasons whose numbers the answer names, and the answer's JSON format, which the app reads; how to judge
// a flip is the person's Instructions (owner 2026-11-16: no hidden text; FLIP_SUGGESTION is offered for them). The
// Instructions go between the meaning and the format, so that whatever they say, the format comes last.
const MEANING = [
  'A flip of an Idena validation: the same four pictures in two orders, LEFT and RIGHT. One order tells a story',
  'from the first picture to the last, the other does not. When keywords are given, they are the two words the',
  "flip's story must show.",
].join('\n')
const FORMAT = [
  'Reply with one JSON object and nothing else:',
  '{"answer": "left" | "right": the order that tells the story, "confidence": how sure the answer is, from 0 to 1,',
  '"keywords": with keywords, "shown" | "not shown"; else null,',
  '"reasons": [{"reason": number, "confidence": from 0 to 1}]: the report reasons the flip breaks, none: [],',
  '"quality": with keywords, how good a flip it is, from 0 to 1; else null}',
  'The report reasons, by number:',
  ...Object.entries(REPORT_REASONS).map(([n, text]) => `${n}. ${text}`),
].join('\n')

/**
 * How the app asked a flip before B-268, as a suggestion for the Instructions (the agent's page inserts it): the
 * person keeps it, edits it or writes their own.
 */
const FLIP_SUGGESTION = [
  'When you solve a flip: pick the order that tells a story that makes sense from the first picture to the last.',
  'When you are not sure, still pick the more probable one and give it a low confidence.',
  'When keywords are given, say whether the story clearly shows both of them, and list each report reason the flip',
  'breaks, with how sure you are that it breaks it. A good flip has a clear story, shows both keywords and breaks no',
  'rule.',
].join('\n')

/** The question's text: what the answer means, the agent's Instructions when it has some, then the format. */
function flipSystem(instructions = '') {
  const own = typeof instructions === 'string' ? instructions.trim() : ''
  return own
    ? [
        MEANING,
        'The instructions of the person who runs you, for this and every task:',
        own,
        FORMAT,
      ].join('\n')
    : [MEANING, FORMAT].join('\n')
}

const SYSTEM = flipSystem('')

function mediaType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  return null
}

function checkOrder(order) {
  if (
    !Array.isArray(order) ||
    order.length !== 4 ||
    !order.every((i) => Number.isInteger(i) && i >= 0 && i < 4)
  )
    throw new Error('invalid flip order')
  return order
}

/** A flip sent by the renderer, checked: four pictures (base64 JPEG, PNG or WebP), two orders, its keywords. */
function checkFlip(flip) {
  if (!flip || typeof flip !== 'object') throw new Error('invalid flip')
  if (!Array.isArray(flip.images) || flip.images.length !== 4)
    throw new Error('a flip has four pictures')
  const images = flip.images.map((data) => {
    if (typeof data !== 'string') throw new Error('invalid flip picture')
    const bytes = Buffer.from(data, 'base64')
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
      throw new Error('invalid flip picture')
    const type = mediaType(bytes)
    if (!type) throw new Error('invalid flip picture')
    return {mediaType: type, data: bytes.toString('base64')}
  })
  if (!Array.isArray(flip.orders) || flip.orders.length !== 2)
    throw new Error('a flip has two orders')
  const orders = flip.orders.map(checkOrder)
  const words = Array.isArray(flip.words)
    ? flip.words.slice(0, 2).map((word) => ({
        name: String(word?.name || '').slice(0, MAX_WORD_LENGTH),
        desc: String(word?.desc || '').slice(0, MAX_WORD_LENGTH),
      }))
    : []
  return {images, orders, words}
}

/** The question: its text (flipSystem), its parts: the keywords, then the left story's four pictures, then the right one's. */
function flipQuestion({images, orders, words}, instructions = '') {
  const parts = []
  const keywords = words.length
    ? `Keywords: ${words
        .map(({name, desc}) => (desc ? `${name} (${desc})` : name))
        .join(', ')}.`
    : 'No keywords: leave "keywords" null and "reasons" empty.'
  parts.push({type: 'text', text: keywords})
  ;['LEFT', 'RIGHT'].forEach((side, s) => {
    parts.push({type: 'text', text: `${side} order, pictures 1 to 4:`})
    orders[s].forEach((i) => parts.push({type: 'image', ...images[i]}))
  })
  parts.push({type: 'text', text: 'Your JSON answer:'})
  return {system: flipSystem(instructions), parts}
}

/** A reply longer than this is cut before it is read: an answer is a few lines. */
const MAX_REPLY_TEXT = 64 * 1024

/**
 * The first JSON object of a reply (models may wrap it in a code block or a sentence): one pass, each outermost
 * {...} tried in turn. An object never closed is no answer.
 */
function firstJsonObject(text) {
  const source = String(text || '').slice(0, MAX_REPLY_TEXT)
  let depth = 0
  let start = -1
  let inString = false
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]
    if (inString) {
      if (c === '\\') i += 1
      else if (c === '"') inString = false
    } else if (c === '"' && depth > 0) inString = true
    else if (c === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (c === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1))
        } catch {
          // not JSON: the next object
        }
      }
    }
  }
  return null
}

const unit = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), 1) : 0
}

/** The reasons the model gave, known ones only, each once (its highest confidence), the surest first. */
function readReasons(list) {
  if (!Array.isArray(list)) return []
  const best = new Map()
  list.slice(0, 32).forEach((item) => {
    const reason = Number(item?.reason)
    if (!Object.prototype.hasOwnProperty.call(REPORT_THRESHOLDS, reason)) return
    const confidence = unit(item.confidence)
    if (!best.has(reason) || best.get(reason) < confidence)
      best.set(reason, confidence)
  })
  return [...best]
    .map(([reason, confidence]) => ({reason, confidence}))
    .sort((a, b) => b.confidence - a.confidence || a.reason - b.reason)
}

/**
 * The model's answer, read strictly: anything unreadable is no answer. `answer` 'left' | 'right' | null,
 * `relevance` 'relevant' | 'irrelevant' | null, `reasons` the report reasons it gave (with keywords only), `report`
 * when one of them reaches its threshold (`thresholds`, by reason; the defaults when left out), `quality` how good a
 * flip it is (with keywords only; null when not given).
 */
function readFlipAnswer(text, {hasWords, thresholds = REPORT_THRESHOLDS}) {
  const reply = firstJsonObject(text)
  const none = {
    answer: null,
    confidence: 0,
    relevance: null,
    reasons: [],
    report: false,
    reportConfidence: 0,
    quality: null,
    doubted: false,
  }
  if (!reply || typeof reply !== 'object') return none
  const answer = ['left', 'right'].includes(reply.answer) ? reply.answer : null
  const reasons = hasWords ? readReasons(reply.reasons) : []
  const reaching = reasons.filter(
    ({reason, confidence}) =>
      confidence >= (thresholds[reason] ?? REPORT_THRESHOLDS[reason])
  )
  const report = reaching.length > 0
  // How sure the report is: its surest reason among those that reach their threshold (B-259 ranks reports by it).
  const reportConfidence = report ? reaching[0].confidence : 0
  // A report marks the flip irrelevant; "not shown" alone, below its threshold, leaves it unmarked.
  let relevance = null
  if (report) relevance = 'irrelevant'
  else if (hasWords && reply.keywords === 'shown') relevance = 'relevant'
  // How good a flip it is (B-260: the best flip's mark), with keywords only; none when the model gave none, or when
  // it half suspects the flip of breaking a rule (a reason from DOUBT, even below its threshold).
  const doubted = reasons.some(({confidence}) => confidence >= DOUBT)
  const quality =
    hasWords &&
    !doubted &&
    reply.quality !== null &&
    reply.quality !== undefined
      ? unit(reply.quality)
      : null
  return {
    answer,
    confidence: unit(reply.confidence),
    relevance,
    reasons,
    report,
    reportConfidence,
    quality,
    // A rule break half suspected: such a flip comes last for the best flip (B-261).
    doubted,
  }
}

module.exports = {
  mediaType,
  REPORT_REASONS,
  REPORT_THRESHOLDS,
  SYSTEM,
  FLIP_SUGGESTION,
  FLIP_FORMAT: FORMAT,
  FLIP_MEANING: MEANING,
  checkFlip,
  firstJsonObject,
  flipQuestion,
  flipSystem,
  readFlipAnswer,
}
