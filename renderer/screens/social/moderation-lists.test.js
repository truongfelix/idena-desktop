import {socialFeed} from './feed'
import {emptyModeration} from './moderation'
import {
  bannedAccounts,
  moderationLog,
  postsToReview,
  reportGroups,
  reportResolution,
} from './moderation-lists'
import {a, authorsOf, b, c, post} from './test-helpers'

const hx = (n) => `0x${String(n).padStart(64, '0')}`
const ban = (extra = {}) => ({
  permanent: true,
  endEpoch: 0,
  reason: '',
  since: {time: 0, height: 0, index: 0},
  bannedAt: 0,
  ...extra,
})

describe('the Moderation page lists', () => {
  it('group the reports by target, each reporter once, most reporters first', () => {
    const state = emptyModeration()
    const report = (kind, target, reporter, time) =>
      state.reports.push({kind, target, reporter, reason: 'r', time})
    report('post', hx(1), a, 1)
    report('address', b, a, 2)
    report('address', b, c, 3)
    report('address', b, a, 4)
    report('post', hx(2), b, 9)
    const groups = reportGroups(state, 240)
    expect(groups.map((g) => [g.target, g.reports.length])).toEqual([
      [b, 2],
      [hx(2), 1],
      [hx(1), 1],
    ])
    expect(groups[0].reports.map((r) => r.time)).toEqual([4, 3])
    // An account banned now: its reports leave the queue.
    state.bans.set(a, ban())
    expect(reportGroups(state, 240).map((g) => g.target)).toEqual([hx(2), b])
  })

  it('say when a report needs nothing more', () => {
    const state = emptyModeration()
    const onPost = {kind: 'post', target: hx(1)}
    expect(reportResolution(onPost, b, state, 240)).toBeNull()
    state.bans.set(b, ban())
    expect(reportResolution(onPost, b, state, 240)).toBe('authorBanned')
    expect(reportResolution({kind: 'address', target: b}, b, state, 240)).toBe(
      'accountBanned'
    )
    state.hidden.set(hx(1), {reason: ''})
    expect(reportResolution(onPost, c, state, 240)).toBe('postHidden')
  })

  it('list the bans in effect, newest first', () => {
    const state = emptyModeration()
    state.bans.set(a, ban({bannedAt: 1}))
    state.bans.set(b, ban({bannedAt: 2}))
    state.bans.set(c, ban({permanent: false, endEpoch: 240}))
    expect(bannedAccounts(state, 240).map((x) => x.address)).toEqual([b, a])
  })

  it("list an account's posts to review, those hidden already left out", () => {
    const posts = [
      post(hx(1), b, 'one', 10),
      post(hx(2), a, 'other', 20),
      post(hx(3), b, 'reply', 30, {replyTo: '1'}),
      post(hx(4), b, 'three', 40),
    ]
    const state = emptyModeration()
    state.hidden.set(hx(4), {reason: ''})
    const feed = socialFeed(posts, authorsOf(posts))
    expect(postsToReview(feed, state, b).map((n) => n.call.hash)).toEqual([
      hx(3),
      hx(1),
    ])
  })

  it('log the decisions, newest first, without the reports', () => {
    const events = [{name: 'ban'}, {name: 'report'}, {name: 'unban'}]
    expect(moderationLog(events).map((e) => e.name)).toEqual(['unban', 'ban'])
  })
})
