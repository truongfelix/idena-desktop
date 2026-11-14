import {
  cleanJoke,
  jokeInput,
  jokeNumberOf,
  jokePost,
  jokeState,
  jokeTextOf,
  thanksLine,
} from './joke'

// The template's example (notes/agent-joke-template.md, Joke #3 of 2026-10-02), taken from the note by script.
const EXAMPLE =
  "📟 3615 IDENA\n\n🃏 Joke #3\n\nA crypto developer walks into a bar.\n\nThe bartender says: “We don't accept crypto.”\n\nThe developer says: “Perfect. I'll just wait for confirmation.”\n\nThanks to 0xb12...898 and 0x0c7...495 for keeping the jokes alive!\nTip this post for a new joke tomorrow 😉"
const EXAMPLE_JOKE =
  "A crypto developer walks into a bar.\n\nThe bartender says: “We don't accept crypto.”\n\nThe developer says: “Perfect. I'll just wait for confirmation.”"

const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const B12 = '0xb12aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa898'
const C07 = '0x0c7bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb495'
const DAY = new Date(2026, 9, 2, 22, 0).getTime()

let seq = 0
const node = (
  message,
  {
    author = ME,
    height,
    tips = [],
    replies = [],
    time = DAY / 1000 - 86400,
    replyTo = '',
  } = {}
) => {
  seq += 1
  return {
    id: seq,
    call: {author, message, replyTo, height, index: 0, time},
    tips,
    likeCalls: [],
    replies,
  }
}
const tip = (from, height, index = 0) => ({from, height, index})

describe('the joke frame', () => {
  test('the post is the template, emoji and all', () => {
    expect(
      jokePost({
        number: 3,
        joke: EXAMPLE_JOKE,
        thanks: thanksLine([B12, C07]),
      })
    ).toBe(EXAMPLE)
  })

  test('a joke post is read back: its number and its joke', () => {
    expect(jokeNumberOf(EXAMPLE)).toBe(3)
    expect(jokeNumberOf('🃏 Joke #12\n\nX')).toBe(12)
    expect(jokeNumberOf('📟 3615 IDENA is open')).toBeNull()
    expect(jokeNumberOf('📰 Chronicle\n🃏 Joke #2')).toBeNull()
    expect(jokeTextOf(EXAMPLE)).toBe(EXAMPLE_JOKE)
  })

  test('the thanks line: names first, short addresses, at most five then the others', () => {
    expect(thanksLine([B12])).toBe(
      'Thanks to 0xb12...898 for keeping the jokes alive!'
    )
    expect(thanksLine([B12, C07], {[C07]: '@alice'})).toBe(
      'Thanks to 0xb12...898 and @alice for keeping the jokes alive!'
    )
    const seven = Array.from({length: 7}, (_, i) => `0x${String(i).repeat(40)}`)
    expect(thanksLine(seven)).toBe(
      'Thanks to 0x000...000, 0x111...111, 0x222...222, 0x333...333, 0x444...444 and 2 others for keeping the jokes alive!'
    )
    expect(thanksLine(seven.slice(0, 6))).toMatch(/ and 1 other for /u)
  })

  test("the model's answer: a code block taken off, nothing or too long refused", () => {
    expect(cleanJoke('```\nA joke.\n```')).toBe('A joke.')
    expect(cleanJoke('  A\n\n\n\nB ')).toBe('A\n\nB')
    expect(cleanJoke('  ')).toBeNull()
    expect(cleanJoke('x'.repeat(601))).toBeNull()
  })

  test('the model reads the recent jokes, numbered', () => {
    expect(jokeInput([])).toBe('Recent jokes (do not repeat):\n\n(none yet)')
    expect(jokeInput(['A', 'B'])).toBe(
      'Recent jokes (do not repeat):\n\n1.\nA\n\n2.\nB'
    )
  })
})

describe("the account's state", () => {
  test('the tippers since the last joke, each once, in tip order, on any of its posts; its own tips left out', () => {
    const feed = [
      node(EXAMPLE, {height: 100, tips: [tip(C07, 101), tip(B12, 103)]}),
      node('🃏 Joke #2\n\nOld one', {height: 50, tips: [tip(B12, 60)]}),
      node('📰 Chronicle', {
        height: 90,
        tips: [tip(B12, 102), tip(ME, 104), tip(C07, 99)],
      }),
      node('Not mine', {author: B12, height: 95, tips: [tip(C07, 105)]}),
    ]
    const state = jokeState(feed, ME, DAY)
    expect(state.lastNumber).toBe(3)
    expect(state.tippers).toEqual([C07, B12])
    expect(state.recent).toEqual(['Old one', EXAMPLE_JOKE])
  })

  test('before the first joke: the tips since the opening post count', () => {
    const feed = [
      node('📟 3615 IDENA is open\n\nTip any post', {
        height: 10,
        tips: [tip(B12, 12)],
      }),
    ]
    expect(jokeState(feed, ME, DAY)).toMatchObject({
      lastNumber: 0,
      tippers: [B12],
    })
  })

  test("today's jokes are counted (local day)", () => {
    const today = node('🃏 Joke #4\n\nNew', {
      height: 200,
      time: DAY / 1000 - 3600,
    })
    const yesterday = node('🃏 Joke #3\n\nOld', {
      height: 100,
      time: DAY / 1000 - 86400,
    })
    expect(jokeState([today, yesterday], ME, DAY).postedToday).toBe(1)
    expect(jokeState([yesterday], ME, DAY).postedToday).toBe(0)
  })

  test('a reply of the account that looks like a joke is not a joke', () => {
    const feed = [
      node('Hello', {
        author: B12,
        height: 10,
        replies: [node('🃏 Joke #9\n\nX', {height: 11, replyTo: '1'})],
      }),
    ]
    expect(jokeState(feed, ME, DAY).lastNumber).toBe(0)
  })
})
