import {socialDigest} from './digest'
import {LINE_NAMES, fillSlots, namedLines} from './texts'

const main = require('../../../../main/agent/app-parts')
const {
  DIGEST_LAYOUT,
  DIGEST_LINES,
  socialTexts,
} = require('../../../../main/agent/social')

// B-285: an agent's own words for what a Social run reads.
const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const ANN = '0xa110000000000000000000000000000000000001'
const BOB = '0xb0b0000000000000000000000000000000000002'
const HEAD = 10000

const node = (id, author, message, height, replies = [], more = {}) => ({
  id,
  call: {author, message, replyTo: '', height, index: 0, time: height * 20},
  likeCalls: [],
  tips: [],
  replies,
  ...more,
})
const like = (author, height) => ({author, height})

/** Every kind a run reads: tips, likes, answers, tags (alone and in an answer), posts with 0, 1 and 2 likes, a chat. */
const state = () => ({
  feed: [
    node(40, ANN, 'ipfs://bafy', 9995),
    node(35, BOB, 'Hey @joke, a question {{label}}', 9994),
    node(31, BOB, 'Liked twice', 9991, [], {
      likeCalls: [like(ANN, 9000), like(ME, 9001)],
    }),
    node(30, ANN, 'Liked once', 9990, [node(32, BOB, '@joke and you?', 9993)], {
      likeCalls: [like(BOB, 9000)],
    }),
    node(
      20,
      ME,
      'Good morning Idena',
      9900,
      [node(21, BOB, 'Good morning to you!', 9950)],
      {
        likeCalls: [like(ANN, 9960)],
        tips: [{from: BOB, height: 9970, tipAmount: '2', amount: '2'}],
        call: {
          author: ME,
          message: 'Good morning Idena',
          replyTo: '',
          height: 9900,
          index: 0,
          time: 9900 * 20,
          hasMedia: true,
        },
      }
    ),
  ],
  me: ME,
  head: HEAD,
  names: {[BOB]: '@bob', [ME]: '@joke'},
  blocked: new Set(),
  conversations: [
    {
      key: `${ME}-${BOB}`,
      others: [BOB],
      isGroup: false,
      messages: [
        {from: ME, text: 'Hello Bob', height: 9000, index: 0},
        {from: BOB, text: 'Hi, how are you?', height: 9980, index: 0},
      ],
    },
  ],
})
const reads = {
  posts: {window: 'count', count: 50},
  notifications: true,
  messages: true,
  own: true,
  tags: true,
}
const digest = (texts, point = 9800) =>
  socialDigest(state(), {reads, texts}, {point, scanned: HEAD})

describe('the renderer fills a text as the main process does', () => {
  test('the same slots, paragraphs and named lines', () => {
    const text = 'Head:\n{{a}}\n\nIdea:\n{{b}}\n\nEnd {{a}}{{c}}.'
    ;[
      {a: 'x', b: ''},
      {a: '', b: ''},
      {a: '{{b}}', b: 'y'},
    ].forEach((values) => {
      expect(fillSlots(text, values)).toBe(main.fillSlots(text, values))
      expect(fillSlots(text, values, {drop: false})).toBe(
        main.fillSlots(text, values, {drop: false})
      )
      expect(fillSlots('No slot.', values, {required: ['a', 'b']})).toBe(
        main.fillSlots('No slot.', values, {required: ['a', 'b']})
      )
    })
    expect(LINE_NAMES).toEqual(Object.keys(DIGEST_LINES))
    const lines = main.namedText(DIGEST_LINES)
    expect(namedLines(lines, LINE_NAMES)).toEqual(DIGEST_LINES)
    expect(namedLines(lines, LINE_NAMES)).toEqual(
      main.namedLines(lines, LINE_NAMES)
    )
  })
})

describe('what a run reads, in the agent’s own words', () => {
  test('the default texts, filled, are what the app writes without a change', () => {
    const plain = digest(null)
    // Every kind is in it: the comparison covers each line.
    ;[
      'Your last posts',
      'Tips to you:',
      'Likes to you:',
      'Answers to you:',
      'Posts that tag you:',
      'New posts:',
      'Private messages to you:',
      '(1 like)',
      '(2 likes)',
      'tipped you 2 iDNA',
      ', answering 0xa110…0001 (',
      '[a text stored on IPFS, not read]',
      '[with a picture or a file]',
      '  you: "Hello Bob"',
    ].forEach((part) => expect(plain.text).toContain(part))
    const texts = socialTexts()
    expect(digest(texts).text).toBe(plain.text)
    expect(digest({socialDigest: DIGEST_LAYOUT}).text).toBe(plain.text)
    expect(digest({socialLines: texts.socialLines}).text).toBe(plain.text)
    // Nothing new: the same too.
    expect(digest(texts, HEAD).text).toBe(digest(null, HEAD).text)
    expect(digest(null, HEAD).text).toContain(
      'Nothing new since your last run.'
    )
  })

  test('an edited layout and edited lines are sent as edited, the other lines as the app’s', () => {
    const {text, labels} = digest({
      socialDigest:
        'NEWS {{sinceLastRun}}\n\nPosts:\n{{posts}}\n\nTips:\n{{tips}}',
      socialLines:
        'post: [{{label}}] {{author}} wrote: {{text}}\nnew: (new things)\ntext on IPFS: (not read)',
    })
    expect(text.startsWith('NEWS (new things)\n\nPosts:\n')).toBe(true)
    expect(text).toContain('] 0xa110…0001 wrote: (not read)')
    // A line it did not write its own for: the app's.
    expect(text).toContain('(2 likes): "Liked twice"')
    expect(text).toContain('@bob tipped you 2 iDNA for "Good morning Idena')
    // A kind the layout has no slot for goes at the end: what the run counts as read is shown.
    expect(text).toContain('"Good morning to you!"')
    expect(text.indexOf('Good morning to you!')).toBeGreaterThan(
      text.indexOf('tipped you')
    )
    expect(labels.size).toBeGreaterThan(0)
  })

  test('a name left empty keeps the app’s line: the item is never an empty line', () => {
    const plain = digest(null)
    expect(digest({socialLines: 'tip:\nanswer: \nlike:'}).text).toBe(plain.text)
  })

  test('a post holding a slot of its own stays words', () => {
    const {text} = digest({
      socialLines: 'tag: {{label}} asks: {{text}} / {{label}}',
    })
    expect(text).toMatch(
      /(p\d+) asks: Hey @joke, a question \{\{label\}\} \/ \1/u
    )
  })

  test('with nothing new, a layout keeps only what has something to say', () => {
    const {text} = digest(
      {
        socialDigest:
          'Mine:\n{{ownPosts}}\n\n{{sinceLastRun}}\n\nPosts:\n{{posts}}',
        socialLines: 'nothing new: All quiet.',
      },
      HEAD
    )
    expect(text).toBe(
      'Mine:\n- "Good morning Idena [with a picture or a file]"\n\nAll quiet.'
    )
    // A layout without the slot of its own posts: they go at the end.
    expect(digest({socialDigest: '{{sinceLastRun}}'}, HEAD).text).toBe(
      'Nothing new since your last run.\n\n- "Good morning Idena [with a picture or a file]"'
    )
  })
})
