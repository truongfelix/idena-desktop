// The joke agent's task (B-237, notes/agent-joke-template.md): the app reads the account's posts and the tips on
// them from the Social feed, numbers the next joke, writes the frame of the post (header, number, thanks line,
// footer) and the model's input (the recent jokes not to repeat). The model writes the joke alone. No tip since the
// last joke: no joke that day.

export const HEADER = '📟 3615 IDENA'
export const OPENING = '📟 3615 IDENA is open'
export const FOOTER = 'Tip this post for a new joke tomorrow 😉'
const JOKE_LINE = /^🃏 Joke #(\d+)$/u
const MAX_NAMES = 5
const RECENT_JOKES = 30
/** A joke the model writes: at most this many characters (the template says 6 short lines). */
export const MAX_JOKE_LENGTH = 600

/** The default instructions of a new joke agent (the template's prompt, without the recent jokes the app adds). */
export const DEFAULT_JOKE_INSTRUCTIONS = `You write the daily joke of 3615 IDENA, a joke service on Idena Social, the social network of the Idena blockchain, where every account is one identity that passes a validation ceremony.

Write ONE new, original joke.

Topics: crypto, blockchain, maths, decentralisation, digital identity, Idena, everyday life and lifestyle, or a mix of them.

Form: pick one, and vary from one day to the next:
- a very short story (a few lines, with a twist at the end);
- a question and its answer;
- a set-up and a funny punchline.

Rules:
- Short: at most 6 short lines, readable at a glance on a phone.
- Friendly and light: no insults, no politics, no religion, no mockery of a real person, a group or a real project.
- Understandable by someone who knows a little about crypto; no jargon a newcomer cannot guess.
- Do not repeat or reword any of the recent jokes the app gives you, and do not reuse their set-up (same bar, same character, same punchline).
- Plain text only: no title, no hashtag, no emoji, no number, no thanks line, no comment before or after the joke.

Answer with the joke alone.`

const lines = (message) => String(message || '').split('\n')

/** A post's lines without the header line that may come first. */
function bodyLines(message) {
  const all = lines(message.trim())
  return all[0].trim() === HEADER ? all.slice(1) : all
}

/** The number of the joke a post is ("🃏 Joke #N" first, after the header), or null. */
export function jokeNumberOf(message) {
  const first = bodyLines(message).find((line) => line.trim() !== '')
  const match = first && JOKE_LINE.exec(first.trim())
  return match ? Number(match[1]) : null
}

/** The joke itself in a joke post: between its number and the thanks line (or the footer). */
export function jokeTextOf(message) {
  const body = bodyLines(message)
  const start = body.findIndex((line) => JOKE_LINE.test(line.trim()))
  if (start < 0) return ''
  const rest = body.slice(start + 1)
  const end = rest.findIndex(
    (line) => line.startsWith('Thanks to ') || line.trim() === FOOTER
  )
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
}

const isOpening = (message) => String(message).trim().startsWith(OPENING)

const chainOrder = (a, b) => a.height - b.height || a.index - b.index
const after = (x, y) =>
  x.height > y.height || (x.height === y.height && x.index > y.index)

/** Every node of the feed (posts, replies, comments). */
function allNodes(feed) {
  const out = []
  const visit = (node) => {
    out.push(node)
    node.replies.forEach(visit)
  }
  feed.forEach(visit)
  return out
}

/**
 * Where the account stands, from the Social `feed` (feed.js nodes) and its address `me`: its last joke (or its
 * opening post: joke 0), the next joke's number, the tippers of any of its posts since that joke (each once, in
 * the order they tipped), the jokes it posted today (local day of `now`), and its recent jokes' texts.
 */
export function jokeState(feed, me, now = Date.now()) {
  const mine = allNodes(feed || [])
    .filter((node) => node.call.author === me)
    .sort((a, b) => chainOrder(a.call, b.call))
  const jokes = mine.filter(
    (node) =>
      node.call.replyTo === '' && jokeNumberOf(node.call.message) !== null
  )
  const opening = mine.find(
    (node) => node.call.replyTo === '' && isOpening(node.call.message)
  )
  const last = jokes.length ? jokes[jokes.length - 1] : opening || null
  const tips = mine
    .flatMap((node) => node.tips)
    .filter((tip) => !last || after(tip, last.call))
    .sort(chainOrder)
  const tippers = []
  tips.forEach((tip) => {
    if (tip.from !== me && !tippers.includes(tip.from)) tippers.push(tip.from)
  })
  const day = new Date(now).toDateString()
  return {
    started: Boolean(last),
    lastNumber: jokes.length
      ? Math.max(...jokes.map((node) => jokeNumberOf(node.call.message)))
      : 0,
    tippers,
    postedToday: jokes.filter(
      (node) => new Date(node.call.time * 1000).toDateString() === day
    ).length,
    recent: jokes
      .slice(-RECENT_JOKES)
      .map((node) => jokeTextOf(node.call.message))
      .filter(Boolean),
  }
}

/** An address written short, as the posts do: 0xb12...898. */
export const shortAddress = (address) =>
  `${address.slice(0, 5)}...${address.slice(-3)}`

/**
 * The thanks line: each tipper's claimed name (`names`: address -> "@name", the profiles contract's) or short
 * address; more than five, the first five "and N others".
 */
export function thanksLine(tippers, names = {}) {
  const shown = tippers.map(
    (address) => names[address] || shortAddress(address)
  )
  let who
  if (shown.length > MAX_NAMES) {
    const others = shown.length - MAX_NAMES
    who = `${shown.slice(0, MAX_NAMES).join(', ')} and ${others} other${
      others > 1 ? 's' : ''
    }`
  } else if (shown.length > 1)
    who = `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  else [who] = shown
  return `Thanks to ${who} for keeping the jokes alive!`
}

/** The joke as the model wrote it, cleaned: a code block or quotes around it taken off; null when nothing is left. */
export function cleanJoke(answer) {
  let joke = String(answer || '').trim()
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/u.exec(joke)
  if (fenced) joke = fenced[1].trim()
  joke = joke.replace(/\n{3,}/gu, '\n\n')
  if (!joke || joke.length > MAX_JOKE_LENGTH) return null
  return joke
}

/** The post: the template's frame around the joke. */
export const jokePost = ({number, joke, thanks}) =>
  `${HEADER}\n\n🃏 Joke #${number}\n\n${joke}\n\n${thanks}\n${FOOTER}`

/** What the model reads: the recent jokes, not to repeat. */
export function jokeInput(recent) {
  const list = recent.length
    ? recent.map((text, i) => `${i + 1}.\n${text}`).join('\n\n')
    : '(none yet)'
  return `Recent jokes (do not repeat):\n\n${list}`
}
