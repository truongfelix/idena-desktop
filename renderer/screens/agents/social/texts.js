// An agent's own words for what a Social run reads (B-285), filled here: the digest is built in the renderer. The
// same rules as the main process's (main/agent/app-parts.js fillSlots, namedLines), held to them by a test.

const SLOT = /\{\{([A-Za-z0-9]+)\}\}/gu

/** The lines an agent may write its own for (main/agent/social.js DIGEST_LINES). */
export const LINE_NAMES = [
  'own post',
  'new',
  'nothing new',
  'tip',
  'like',
  'answer',
  'tag',
  'tag in an answer',
  'thread post',
  'thread reply',
  'post',
  'post with one like',
  'post with likes',
  'conversation',
  'message',
  'you',
  'text on IPFS',
  'with a file',
  'with a picture',
]

/**
 * A text with its slots filled, in one pass: a value holding a "{{...}}" of its own (a post: other people's words)
 * is never filled in turn. A paragraph whose slots all hold nothing is left out, unless `drop` is false. A `required`
 * value the text has no slot for goes at its end, a paragraph each.
 */
export function fillSlots(
  template,
  values = {},
  {required = [], drop = true} = {}
) {
  const has = (name) => Object.prototype.hasOwnProperty.call(values, name)
  const valueOf = (name) =>
    values[name] === null || values[name] === undefined
      ? ''
      : String(values[name])
  const fill = (text) =>
    text.replace(SLOT, (slot, name) => (has(name) ? valueOf(name) : slot))
  const source = String(template)
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

/** A text of named lines, "name: the line", read: the first line of each name in `names` that it holds. */
export function namedLines(text, names) {
  const lines = {}
  String(text || '')
    .split('\n')
    .forEach((line) => {
      const at = line.indexOf(':')
      if (at < 1) return
      const name = line.slice(0, at).trim()
      if (!names.includes(name) || name in lines) return
      const rest = line.slice(at + 1)
      // A name with nothing after it is no line of its own: the app's stays.
      if (!rest.trim()) return
      lines[name] = rest.startsWith(' ') ? rest.slice(1) : rest
    })
  return lines
}
