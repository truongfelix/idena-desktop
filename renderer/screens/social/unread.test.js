import {
  conversations,
  firstChatStore,
  readChatStore,
  unreadCount,
  unreadMessages,
} from './messages'
import {loadChatStore} from './storage'
import {a, b} from './test-helpers'

// Ported from the phone app's SocialUnreadTest.kt.

const msg = (from, to, height, index = 0) => ({
  hash: `0x${height}-${index}`,
  height,
  time: height * 20,
  index,
  from,
  participants: [from, to],
  text: 'x',
  textPassword: '',
  hasMedia: false,
  isReply: false,
})

const withB = (...messages) => conversations(messages, a, {})[0]
const heights = (list) => list.map(({height}) => height)

describe('unread messages', () => {
  it('are those after my last answer', () => {
    const conversation = withB(
      msg(b, a, 10),
      msg(b, a, 11),
      msg(a, b, 12),
      msg(b, a, 13),
      msg(b, a, 14)
    )
    expect(heights(unreadMessages(conversation, a, null))).toEqual([13, 14])
    // A read point after my answer, and one before it.
    expect(heights(unreadMessages(conversation, a, [13, 0]))).toEqual([14])
    expect(heights(unreadMessages(conversation, a, [10, 0]))).toEqual([13, 14])
    // Never answered; only mine.
    expect(
      unreadCount(withB(msg(b, a, 10), msg(b, a, 11), msg(b, a, 12)), a, null)
    ).toBe(3)
    expect(unreadCount(withB(msg(a, b, 10)), a, null)).toBe(0)
  })

  it('after an answer in the same block are only those after it', () => {
    const conversation = withB(
      msg(b, a, 10, 0),
      msg(a, b, 10, 1),
      msg(b, a, 10, 2)
    )
    expect(
      unreadMessages(conversation, a, null).map(({index}) => index)
    ).toEqual([2])
  })

  it('start at the store first loaded here', () => {
    const conversation = withB(msg(b, a, 10), msg(b, a, 20), msg(b, a, 30))
    expect(heights(unreadMessages(conversation, a, null, 20 * 20))).toEqual([
      20, 30,
    ])
    expect(unreadCount(conversation, a, null)).toBe(3)
    // A read point still counts.
    expect(heights(unreadMessages(conversation, a, [20, 0], 10 * 20))).toEqual([
      30,
    ])
  })
})

describe('the store of an account', () => {
  const now = 1800000000
  const fakeDb = (saved) => {
    const puts = []
    return {
      puts,
      get: async () => {
        if (saved === undefined) {
          const error = new Error('NotFound')
          error.notFound = true
          throw error
        }
        return saved
      },
      put: async (key, value) => {
        puts.push([key, value])
      },
    }
  }

  it('first loaded here reads what is older than three days, saved at once', async () => {
    expect(firstChatStore(now).readBefore).toBe(now - 3 * 24 * 3600)
    const db = fakeDb(undefined)
    const store = await loadChatStore(a, db, now + 0.5)
    expect(store.readBefore).toBe(now - 3 * 24 * 3600)
    expect(db.puts).toEqual([[`messages-${a}`, store]])
    expect(readChatStore(JSON.parse(JSON.stringify(store)))).toEqual(store)
  })

  it('saved by an earlier build keeps its read points', async () => {
    const earlier = {tried: [], messages: [], seen: {k: [10, 0]}}
    const db = fakeDb(earlier)
    const store = await loadChatStore(a, db, now)
    // With no group and no message code yet.
    expect(store).toEqual({
      ...earlier,
      groupKeys: [],
      groupTried: [],
      sharedKeys: {},
    })
    expect('readBefore' in store).toBe(false)
    expect(db.puts).toEqual([])
  })
})
