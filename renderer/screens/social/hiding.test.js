import {LIKE} from './contract'
import {ActivityKind} from './activity'
import {
  person,
  withPerson,
  blockedAddresses,
  peopleFromJson,
  peopleToJson,
} from './people'
import {
  MAX_HIDDEN_WORD,
  NO_HIDING,
  cleanHiddenWord,
  hiddenEntries,
  hidesText,
  hiding,
  threadPost,
  txHashOf,
  visibleActivity,
  visibleConversations,
  visibleFeed,
  wordFilter,
} from './hiding'
import {tip} from './test-helpers'

// Ported from the phone app's SocialHidingTest.kt: both apps hide the same things.

const me = '0xaaaa000000000000000000000000000000000001'
const bob = '0xbbbb000000000000000000000000000000000002'
const eve = '0xeeee000000000000000000000000000000000003'

const call = (
  id,
  author,
  text = 'hello',
  {replyTo = '', channel = ''} = {}
) => ({
  hash: `0x${id}`,
  height: id,
  time: id,
  index: 0,
  author,
  message: text,
  replyTo,
  channel,
  hasMedia: false,
  media: '',
  mediaType: '',
})

const node = (id, author, text, options = {}, replies = []) => ({
  id,
  call: call(id, author, text, options),
  likeCalls: [],
  tips: [],
  replies,
})

const ids = (feed) => {
  const all = []
  const visit = (n) => {
    all.push(n.id)
    n.replies.forEach(visit)
  }
  feed.forEach(visit)
  return all
}

const discuss = (id) => `discuss:${id}`

describe('hidden words', () => {
  it('match whole words without case or accents', () => {
    const filter = wordFilter(['spam', 'Café', 'free coins'])
    expect(filter.matches('Buy SPAM now')).toBe(true)
    expect(filter.matches('spam!')).toBe(true)
    // Accents ignored, both ways.
    expect(filter.matches('a cafe here')).toBe(true)
    expect(wordFilter(['cafe']).matches('au Café')).toBe(true)
    // A phrase, spaces collapsed.
    expect(filter.matches('get  Free\ncoins today')).toBe(true)
    // Not inside a longer word, at its start or its end.
    expect(filter.matches('spammer')).toBe(false)
    expect(filter.matches('antispam')).toBe(false)
    expect(filter.matches('free coin')).toBe(false)
    expect(filter.matches('')).toBe(false)
    expect(wordFilter(['  ', '']).isEmpty).toBe(true)
  })

  it('take what a regular expression means as plain text', () => {
    const filter = wordFilter(['a.b', '(x)', 'c++'])
    expect(filter.matches('see a.b here')).toBe(true)
    expect(filter.matches('see axb here')).toBe(false)
    expect(filter.matches('say (x) now')).toBe(true)
    expect(filter.matches('I write c++')).toBe(true)
  })

  it('are cleaned and cut', () => {
    expect(cleanHiddenWord('  free \t coins\n')).toBe('free coins')
    expect(cleanHiddenWord('   ')).toBeNull()
    expect(cleanHiddenWord(7)).toBeNull()
    expect(cleanHiddenWord('x'.repeat(100))).toHaveLength(MAX_HIDDEN_WORD)
  })
})

describe('what is hidden', () => {
  it('leaves a blocked account out of the feed, the threads, the likes and the tips', () => {
    const like = call(90, eve, LIKE, {replyTo: '1'})
    const bobsReply = node(3, bob, 'hello', {replyTo: '1'}, [
      node(5, eve, 'hello', {channel: discuss(3)}),
      node(6, bob, 'hello', {replyTo: '5', channel: discuss(3)}),
      node(7, me, 'hello', {replyTo: '5', channel: discuss(3)}),
      node(8, bob, 'hello', {replyTo: '6', channel: discuss(3)}),
      node(9, bob, 'hello', {channel: discuss(3)}),
    ])
    const feed = [
      {
        ...node(1, bob, 'hello', {}, [
          node(2, eve, 'hello', {replyTo: '1'}),
          bobsReply,
        ]),
        likeCalls: [like],
        tips: [tip('0xt', eve, '1', '1', '1', 91)],
      },
      node(4, eve),
    ]
    const shown = visibleFeed(feed, hiding({blocked: new Set([eve])}), me)
    // 5 is eve's; 6 and 8 answer it (8 through 6) and leave with it; 7 is mine and stays; 9 stays.
    expect(ids(shown)).toEqual([1, 3, 7, 9])
    expect(shown[0].likeCalls).toEqual([])
    expect(shown[0].tips).toEqual([])
    // Nothing hidden: the same list.
    expect(visibleFeed(feed, NO_HIDING, me)).toBe(feed)
  })

  it('leaves a post with a hidden word out of the lists, but not mine', () => {
    const feed = [
      node(1, bob, 'Free coins here', {}, [
        node(3, bob, 'free coins', {replyTo: '1'}),
      ]),
      node(2, me, 'free coins, says the spammer'),
      node(
        4,
        bob,
        'ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
      ),
      node(5, eve, 'hello', {}, [node(6, bob, 'free coins', {replyTo: '5'})]),
    ]
    const shown = visibleFeed(
      feed,
      hiding({words: wordFilter(['free coins'])}),
      me
    )
    // A reply with the word stays: its thread folds it. A text on IPFS is checked once fetched.
    expect(ids(shown)).toEqual([2, 4, 5, 6])
  })

  it('leaves blocked accounts and hidden answers out of the notifications', () => {
    const post = call(1, me)
    const item = (kind, actor, height, answer) => ({
      kind,
      actor,
      height,
      index: 0,
      time: height,
      threadId: 1,
      focusId: height,
      what: post,
      ...(answer ? {answer} : {}),
    })
    const items = [
      item(ActivityKind.Like, eve, 10),
      item(
        ActivityKind.Reply,
        bob,
        11,
        call(2, bob, 'free coins', {replyTo: '1'})
      ),
      item(ActivityKind.Reply, bob, 12, call(3, bob, 'thanks', {replyTo: '1'})),
      item(ActivityKind.Tip, bob, 13),
      item(ActivityKind.Reply, bob, 14, call(4, bob, 'rude', {replyTo: '1'})),
    ]
    const hidden = hiding({
      blocked: new Set([eve]),
      words: wordFilter(['free coins']),
      posts: new Set([call(4, bob).hash]),
    })
    expect(
      visibleActivity(items, hidden, me).map(({height}) => height)
    ).toEqual([12, 13])
  })

  it('leaves a post hidden or in a blocked topic out of the lists', () => {
    const feed = [
      node(1, bob, 'hello', {}, [node(3, eve, 'hello', {replyTo: '1'})]),
      node(2, bob, 'hello', {channel: 'r/flips'}),
      node(4, eve, 'hello', {channel: 'r/idena'}),
      node(5, me, 'hello', {channel: 'r/flips'}),
      node(6, me),
    ]
    const hidden = hiding({
      posts: new Set([call(1, bob).hash, call(3, eve).hash, call(6, me).hash]),
      topics: new Set(['flips']),
    })
    // 3 is a reply: its thread folds it. Mine stay, hidden or in a blocked topic.
    expect(ids(visibleFeed(feed, hidden, me))).toEqual([4, 5, 6])
  })

  it('still opens a hidden post, but not a blocked one', () => {
    const feed = [
      node(1, bob, 'free coins', {}, [node(3, eve, 'hello', {replyTo: '1'})]),
      node(2, eve),
    ]
    const hidden = hiding({
      blocked: new Set([eve]),
      words: wordFilter(['free coins']),
      posts: new Set([call(1, bob).hash]),
    })
    expect(ids([threadPost(feed, '1', hidden, me)])).toEqual([1])
    expect(threadPost(feed, '2', hidden, me)).toBeNull()
    expect(threadPost(feed, '9', hidden, me)).toBeNull()
  })

  it('checks a hash and makes it lowercase', () => {
    const hash = `0x${'Ab'.repeat(32)}`
    expect(txHashOf(` ${hash} `)).toBe(hash.toLowerCase())
    expect(txHashOf('0x1234')).toBeNull()
    expect(txHashOf('ab'.repeat(32))).toBeNull()
    // Any case hides.
    const hidden = hiding({posts: new Set([hash.toLowerCase()])})
    expect(hidesText(hidden, {...call(1, bob), hash}, me)).toBe(true)
  })

  it('leaves a conversation with a blocked account out', () => {
    const list = [
      {key: 'a', others: [bob]},
      {key: 'b', others: [eve]},
      {key: 'c', others: [bob, eve]},
    ]
    expect(
      visibleConversations(list, new Set([eve])).map(({key}) => key)
    ).toEqual(['a'])
  })

  it('keeps the blocked mark and undoes it', () => {
    const blocked = person(eve, {blocked: true})
    // A blocked account stays in the list.
    expect(withPerson({}, blocked)).toEqual({[eve]: blocked})
    expect(peopleFromJson(peopleToJson({[eve]: blocked}))).toEqual({
      [eve]: blocked,
    })
    expect(
      blockedAddresses({[eve]: blocked, [bob]: person(bob, {name: 'Bob'})})
    ).toEqual(new Set([eve]))
    expect(
      withPerson(withPerson({}, blocked), person(eve, {blocked: false}))
    ).toEqual({})
  })

  it('lists the posts hidden, those not read first, then the newest', () => {
    const feed = [
      node(5, bob, 'hello', {}, [node(7, eve, 'hello', {replyTo: '5'})]),
      node(2, bob),
    ]
    const unknown = `0x${'cd'.repeat(32)}`
    const entries = hiddenEntries(feed, ['0x2', '0x7', unknown])
    expect(entries.map(({hash}) => hash)).toEqual([unknown, '0x7', '0x2'])
    expect(entries[1].threadId).toBe(5)
    expect(entries[1].node.id).toBe(7)
    expect(entries[0].node).toBeUndefined()
  })
})
