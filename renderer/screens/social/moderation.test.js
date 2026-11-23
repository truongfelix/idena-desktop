import {LIKE} from './contract'
import {socialFeed} from './feed'
import {
  MODERATION_CONTRACT,
  activeBan,
  callEvents,
  decodeEvent,
  emptyModeration,
  replay,
  vouchersOf,
} from './moderation'
import {hiddenStatus, moderatedFeed, moderatedProfile} from './moderation-feed'
import {a, authorsOf, b, c, hex, post} from './test-helpers'

// The events as the contract writes them (idena.social-mod assembly/index.ts): addresses 20 bytes, numbers
// little-endian, booleans 1 byte, texts UTF-8.
const le = (value, size) => {
  const bytes = []
  let left = value
  for (let i = 0; i < size; i += 1) {
    bytes.push(left % 256)
    left = Math.floor(left / 256)
  }
  return `0x${Buffer.from(bytes).toString('hex')}`
}
const h1 = `0x${'11'.repeat(32)}`
const hx = (n) => `0x${String(n).padStart(64, '0')}`
const h2 = `0x${'22'.repeat(32)}`
const banArgs = (address, moderator, epoch, permanent, endEpoch, reason) => [
  address,
  moderator,
  le(epoch, 2),
  le(permanent ? 1 : 0, 1),
  le(endEpoch, 4),
  hex(reason),
]

let seq = 0
const contractCall = (events, {success = true, time = 100} = {}) => {
  seq += 1
  return {
    hash: `0x${String(seq).padStart(64, '0')}`,
    height: seq,
    index: 0,
    timestamp: time,
    success,
    events: events.map(([event, args, contract = MODERATION_CONTRACT]) => ({
      contract,
      event,
      args,
    })),
  }
}

describe('the contract events', () => {
  it('are read as the contract writes them', () => {
    expect(
      decodeEvent('ban', banArgs(a, b, 240, false, 243, 'Spam'))
    ).toMatchObject({
      name: 'ban',
      address: a,
      moderator: b,
      epoch: 240,
      permanent: false,
      endEpoch: 243,
      reason: 'Spam',
    })
    expect(
      decodeEvent('banTransaction', [h1.toUpperCase(), b, le(240, 2), '0x'])
    ).toMatchObject({hash: h1, moderator: b, epoch: 240, reason: ''})
    expect(decodeEvent('vouch', [a, b, le(2, 4)])).toMatchObject({
      address: a,
      voucher: b,
      count: 2,
    })
    expect(
      decodeEvent('reportTransaction', [h1, c, hex('Scam')])
    ).toMatchObject({hash: h1, reporter: c, reason: 'Scam'})
  })

  it('are dropped when unknown or unreadable', () => {
    expect(decodeEvent('other', [a])).toBeNull()
    expect(decodeEvent('ban', banArgs('0x12', b, 1, true, 0, ''))).toBeNull()
    expect(decodeEvent('unban', [a, b])).toBeNull()
    expect(decodeEvent('banTransaction', [h1, b, le(1, 3), '0x'])).toBeNull()
  })

  it('come from the accepted calls only, the contract own events only', () => {
    const events = callEvents([
      contractCall([['ban', banArgs(a, b, 240, true, 0, 'Spam')]]),
      contractCall([['ban', banArgs(c, b, 240, true, 0, '')]], {
        success: false,
      }),
      contractCall([
        ['ban', banArgs(c, b, 240, true, 0, ''), `0x${'99'.repeat(20)}`],
      ]),
      contractCall([]),
    ])
    expect(events.map((e) => e.address)).toEqual([a])
  })

  it('cannot be read from a node that does not return them', () => {
    const {events, ...call} = contractCall([])
    expect(() => callEvents([call])).toThrow('does not return the events')
  })
})

describe('the moderation state', () => {
  const stateOf = (...calls) => replay(callEvents(calls))

  it('keeps the bans until lifted or ended', () => {
    const state = stateOf(
      contractCall([['ban', banArgs(a, b, 240, false, 242, 'Spam')]]),
      contractCall([['ban', banArgs(c, b, 240, true, 0, 'Scam')]]),
      contractCall([['unban', [c, b, hex('Appeal')]]])
    )
    expect(
      activeBan(state, a.toUpperCase().replace('0X', '0x'), 241)
    ).toMatchObject({
      reason: 'Spam',
    })
    expect(activeBan(state, a, 242)).toBeNull()
    expect(activeBan(state, a, null)).not.toBeNull()
    expect(activeBan(state, c, 241)).toBeNull()
  })

  it('starts a ban where the uninterrupted one began', () => {
    const state = stateOf(
      contractCall([['ban', banArgs(a, b, 240, false, 242, 'One')]], {
        time: 100,
      }),
      contractCall([['ban', banArgs(a, b, 241, false, 250, 'Two')]], {
        time: 200,
      }),
      contractCall([['ban', banArgs(c, b, 240, false, 241, 'One')]], {
        time: 100,
      }),
      contractCall([['ban', banArgs(c, b, 241, true, 0, 'Again')]], {time: 300})
    )
    expect(state.bans.get(a)).toMatchObject({
      reason: 'Two',
      since: {time: 100},
    })
    expect(state.bans.get(c)).toMatchObject({
      permanent: true,
      since: {time: 300},
    })
  })

  it('keeps the hidden posts, the vouches and the reports', () => {
    const state = stateOf(
      contractCall([
        ['banTransaction', [h1, b, le(240, 2), hex('Spam')]],
        ['banTransaction', [h2, b, le(240, 2), '0x']],
      ]),
      contractCall([['unbanTransaction', [h2, b, '0x']]]),
      contractCall([['vouch', [a, b, le(1, 4)]]]),
      contractCall([['vouch', [a, c, le(2, 4)]]]),
      contractCall([['vouchWithdrawn', [a, b, le(1, 4)]]]),
      contractCall([['vouch', [c, b, le(1, 4)]]]),
      contractCall([['vouchesRevoked', [c, a, le(1, 4)]]]),
      contractCall([['report', [a, c, hex('Spam')]]])
    )
    expect([...state.hidden.keys()]).toEqual([h1])
    expect(vouchersOf(state, a)).toEqual([c])
    expect(vouchersOf(state, c)).toEqual([])
    expect(state.reports).toEqual([
      expect.objectContaining({kind: 'address', target: a, reporter: c}),
    ])
  })
})

describe('the feed under moderation', () => {
  // Banned from the call at height `since`, index 0 (post() gives a post its time as its height).
  const banned = (address, since, extra = {}) => {
    const state = emptyModeration()
    state.bans.set(address, {
      permanent: true,
      endEpoch: 0,
      reason: 'Spam',
      since: {time: since, height: since, index: 0},
      ...extra,
    })
    return state
  }
  const feedOf = (posts) => socialFeed(posts, authorsOf(posts))

  it('is the same feed when nothing is moderated', () => {
    const feed = feedOf([post(hx(1), a, 'one', 10)])
    expect(moderatedFeed(feed, emptyModeration(), 240)).toBe(feed)
  })

  it('never shows a post made during its author ban', () => {
    const posts = [
      post(hx(1), b, 'during the ban', 20),
      post(hx(2), a, 'a reply', 30, {replyTo: '1'}),
    ]
    expect(moderatedFeed(feedOf(posts), banned(b, 19), 240)).toEqual([])
  })

  it('keeps an older post as a placeholder while an answer is shown', () => {
    const posts = [
      post(hx(1), b, 'before the ban', 10, {hasMedia: true}),
      post(hx(2), b, 'alone', 11),
      post(hx(3), a, 'a reply', 30, {replyTo: '1'}),
    ]
    const [shown, ...rest] = moderatedFeed(feedOf(posts), banned(b, 20), 240)
    expect(rest).toEqual([])
    expect(shown.moderated).toEqual({reason: 'Spam'})
    expect(shown.call).toMatchObject({
      message: '',
      hasMedia: false,
      media: '',
      moderated: true,
    })
    expect(shown.replies.map((r) => r.call.message)).toEqual(['a reply'])
  })

  it('shows everything again once the ban ended', () => {
    const posts = [post(hx(1), b, 'during the ban', 20)]
    const state = banned(b, 20, {permanent: false, endEpoch: 241})
    expect(moderatedFeed(feedOf(posts), state, 241)).toHaveLength(1)
    expect(moderatedFeed(feedOf(posts), state, 240)).toEqual([])
  })

  it('hides a post one by one, and its comments by their answers', () => {
    const posts = [
      post(hx(1), a, 'post', 10),
      post(hx(2), b, 'reply', 20, {replyTo: '1'}),
      post(hx(3), c, 'hidden comment', 30, {
        replyTo: '2',
        channel: 'discuss:2',
      }),
      post(hx(4), a, 'answer', 40, {replyTo: '3', channel: 'discuss:2'}),
      post(hx(5), c, 'hidden alone', 50, {replyTo: '2', channel: 'discuss:2'}),
      post(hx(6), c, LIKE, 60, {replyTo: '1'}),
    ]
    const state = emptyModeration()
    for (const hash of [hx(3), hx(5), hx(6)])
      state.hidden.set(hash, {reason: ''})
    const [shown] = moderatedFeed(feedOf(posts), state, 240)
    expect(shown.likeCalls).toHaveLength(1)
    const comments = shown.replies[0].replies
    expect(comments.map((x) => [x.call.message, x.moderated])).toEqual([
      ['', {reason: ''}],
      ['answer', undefined],
    ])
  })

  it('takes a hidden reply away with its hidden comments', () => {
    const posts = [
      post(hx(1), a, 'post', 10),
      post(hx(2), b, 'reply', 20, {replyTo: '1'}),
      post(hx(3), b, 'comment', 30, {replyTo: '2', channel: 'discuss:2'}),
    ]
    const [shown] = moderatedFeed(feedOf(posts), banned(b, 15), 240)
    expect(shown.replies).toEqual([])
  })

  it('counts a post earlier in the ban block as made before it', () => {
    const state = banned(b, 20)
    state.bans.get(b).since.index = 3
    const at = (index) => ({...post(hx(1), b, 'text', 20), index})
    expect(hiddenStatus(at(2), state, 240)).toEqual({
      kind: 'hidden',
      reason: 'Spam',
    })
    expect(hiddenStatus(at(4), state, 240)).toEqual({kind: 'duringBan'})
  })

  it('shows a banned profile without its details, but to its owner', () => {
    const profile = {address: b, name: 'bee', bio: 'hi', picture: 'ipfs://x'}
    const state = banned(b, 0)
    expect(moderatedProfile(profile, b, state, 240)).toMatchObject({
      name: '',
      bio: '',
      picture: '',
      inStanding: false,
      banned: expect.objectContaining({reason: 'Spam'}),
    })
    expect(moderatedProfile(profile, b, state, 240, b)).toMatchObject({
      name: 'bee',
      bio: 'hi',
      banned: expect.objectContaining({reason: 'Spam'}),
    })
    expect(moderatedProfile(profile, a, state, 240)).toBe(profile)
  })

  it('never hides a like, but a like with media', () => {
    const like = post(hx(2), b, LIKE, 30, {replyTo: '1'})
    expect(hiddenStatus(like, banned(b, 0), 240)).toBeNull()
    expect(hiddenStatus({...like, hasMedia: true}, banned(b, 0), 240)).toEqual({
      kind: 'duringBan',
    })
  })
})
