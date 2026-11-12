// The agent's validation tool: one flip to the model, its answer read back. A flip is four pictures and two orders
// of them; one order tells a story, the other does not. In the long session the model also says whether the story
// shows its two keywords, and whether it should be reported; a report counts only when the model is very sure.

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_WORD_LENGTH = 200

/** The confidence a report needs (the template: "reports when very sure"). */
const REPORT_CONFIDENCE = 0.9

const SYSTEM = [
  'You solve flips in an Idena validation. A flip is a story of four pictures. You see the same four pictures in',
  'two orders, LEFT and RIGHT: one order tells a story that makes sense from the first picture to the last, the',
  'other does not. Pick the order that tells the story. When you are not sure, still pick the more probable one',
  'and give it a low confidence.',
  'When keywords are given, also say whether the story clearly shows both of them, and whether the flip should',
  'be reported: its keywords are not shown, it needs text, numbers or arrows on the pictures to be solved, or it',
  'shows something cruel, sexual or offensive.',
  'Reply with one JSON object and nothing else:',
  '{"answer": "left" | "right", "confidence": how sure the answer is, from 0 to 1,',
  '"keywords": "shown" | "not shown" | null, "report": true | false,',
  '"reportConfidence": how sure the flip breaks the rules, from 0 to 1}',
].join('\n')

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

/** The question's parts: the text, then the left story's four pictures, then the right one's. */
function flipQuestion({images, orders, words}) {
  const parts = []
  const keywords = words.length
    ? `Keywords: ${words
        .map(({name, desc}) => (desc ? `${name} (${desc})` : name))
        .join(', ')}.`
    : 'No keywords: leave "keywords" null and "report" false.'
  parts.push({type: 'text', text: keywords})
  ;['LEFT', 'RIGHT'].forEach((side, s) => {
    parts.push({type: 'text', text: `${side} order, pictures 1 to 4:`})
    orders[s].forEach((i) => parts.push({type: 'image', ...images[i]}))
  })
  parts.push({type: 'text', text: 'Your JSON answer:'})
  return {system: SYSTEM, parts}
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

/**
 * The model's answer, read strictly: anything unreadable is no answer. `answer` 'left' | 'right' | null,
 * `relevance` 'relevant' | 'irrelevant' | null, `report` only when the model is very sure and the keywords
 * are not shown.
 */
function readFlipAnswer(text, {hasWords}) {
  const reply = firstJsonObject(text)
  const none = {answer: null, confidence: 0, relevance: null, report: false}
  if (!reply || typeof reply !== 'object') return none
  const confidence = Number(reply.confidence)
  const sure = Number.isFinite(confidence)
    ? Math.min(Math.max(confidence, 0), 1)
    : 0
  const answer = ['left', 'right'].includes(reply.answer) ? reply.answer : null
  const reportConfidence = Number(reply.reportConfidence)
  const report =
    hasWords &&
    reply.report === true &&
    Number.isFinite(reportConfidence) &&
    reportConfidence >= REPORT_CONFIDENCE
  // "Not shown" marks the flip irrelevant, which is a report: only when the model is very sure.
  let relevance = null
  if (report) relevance = 'irrelevant'
  else if (hasWords && reply.keywords === 'shown') relevance = 'relevant'
  return {answer, confidence: sure, relevance, report}
}

module.exports = {
  REPORT_CONFIDENCE,
  SYSTEM,
  checkFlip,
  firstJsonObject,
  flipQuestion,
  readFlipAnswer,
}
