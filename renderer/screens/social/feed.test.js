import {validTipAmount} from './calls'
import {LIKE} from './contract'
import {
  FeedPeriod,
  FeedSort,
  lastActivityHeight,
  likeCount,
  postIds,
  replyCount,
  socialFeed,
  sortFeed,
  tipTotal,
} from './feed'
import {a, authorsOf, b, c, post, tip} from './test-helpers'

// Ported from the phone app's SocialTest.kt: both apps read idena.social the same way.

describe('post ids', () => {
  it('follow the contract authors', () => {
    const posts = [
      post('h1', a, '1', 10),
      post('h2', b, '2', 20),
      post('h3', a, '3', 30),
    ]
    expect(Object.fromEntries(postIds(posts, {1: a, 2: b, 3: a}))).toEqual({
      h1: 1,
      h2: 2,
      h3: 3,
    })
  })

  it('give no id to a failed call', () => {
    const posts = [
      post('h1', a, '1', 10),
      post('h2', c, 'failed', 20),
      post('h3', b, '2', 30),
    ]
    expect(Object.fromEntries(postIds(posts, {1: a, 2: b}))).toEqual({
      h1: 1,
      h3: 2,
    })
  })

  it('reach the newest posts before the history is read', () => {
    const posts = [post('h2', b, '2', 20), post('h3', a, '3', 30)]
    expect(Object.fromEntries(postIds(posts, {1: a, 2: b, 3: a}))).toEqual({
      h2: 2,
      h3: 3,
    })
  })

  it('follow the block order of a block', () => {
    const posts = [
      post('second', b, '2', 10, {index: 1}),
      post('first', a, '1', 10, {index: 0}),
    ]
    expect(Object.fromEntries(postIds(posts, {1: a, 2: b}))).toEqual({
      first: 1,
      second: 2,
    })
  })

  it('are empty without authors', () => {
    expect(postIds([post('h1', a, '1', 10)], {}).size).toBe(0)
  })
})

describe('the feed', () => {
  it("follows idena.social's rules", () => {
    // In chain order, so post n gets id n.
    const posts = [
      post('p1', a, 'hello', 100),
      post('p2', b, 'same block time as its post', 100, {
        replyTo: '1',
        index: 1,
      }),
      post('p3', b, LIKE, 110, {replyTo: '1'}),
      post('p4', c, 'nice', 120, {replyTo: '1'}),
      post('p5', a, 'thanks', 130, {replyTo: '4', channel: 'discuss:4'}),
      post('p6', c, 'reply to a like', 140, {replyTo: '3'}),
      post('p7', a, '', 150),
      post('p8', b, 'other channel', 160, {channel: 'news'}),
      post('p9', c, 'reply to an unknown post', 170, {replyTo: '99'}),
      post('p10', b, 'second post', 200),
      post('p11', a, LIKE, 210, {replyTo: '4', channel: 'discuss:4'}),
      post('p12', b, LIKE, 220, {replyTo: '5', channel: 'discuss:4'}),
      post('p13', c, 'answer to a comment, main channel', 230, {replyTo: '5'}),
      post('p14', c, 'comment in the channel of a post, not a reply', 240, {
        channel: 'discuss:1',
      }),
    ]
    const feed = socialFeed(posts, authorsOf(posts))
    expect(feed.map((n) => n.id)).toEqual([10, 1])
    const first = feed[1]
    expect(likeCount(first)).toBe(1)
    expect(first.replies.map((n) => n.id)).toEqual([4])
    const reply = first.replies[0]
    expect(likeCount(reply)).toBe(1)
    expect(reply.replies.map((n) => n.id)).toEqual([5, 13])
    expect(likeCount(reply.replies[0])).toBe(1)
    expect(first.likeCalls.map((l) => l.author)).toEqual([b])
    expect(replyCount(first)).toBe(3)
    expect(replyCount(feed[0])).toBe(0)
  })

  it('counts only the tips the contract accepts', () => {
    expect(validTipAmount(tip('t', a, '1', '5', '5', 10))).toBe(5)
    expect(validTipAmount(tip('t', a, '1', '5', '6.5', 10))).toBe(5)
    expect(validTipAmount(tip('t', a, '1', '0.5', '0.5', 10))).toBeNull()
    expect(validTipAmount(tip('t', a, '1', '0', '1', 10))).toBeNull()
    expect(validTipAmount(tip('t', a, '1', '5', '4.99', 10))).toBeNull()
    expect(validTipAmount(tip('t', a, '1', '', '1', 10))).toBeNull()
    expect(validTipAmount(tip('t', a, '1', '5', '0005.0', 10))).toBe(5)
    expect(validTipAmount(tip('t', a, '1', '5', '12', 10))).toBe(5)
    expect(validTipAmount(tip('t', a, '1', '5', 'x', 10))).toBeNull()
  })

  it('counts a tip on its post after it', () => {
    const posts = [
      post('p1', a, 'hello', 100),
      post('p2', b, 'reply', 110, {replyTo: '1'}),
    ]
    const tips = [
      tip('t1', b, '1', '3', '3', 105),
      tip('t2', c, '1', '2', '2', 120),
      tip('t3', c, '1', '1', '1', 90),
      tip('t4', c, '2', '0.5', '0.5', 120),
      tip('t5', c, '9', '1', '1', 120),
      tip('t6', a, '2', '4', '4', 130),
    ]
    const feed = socialFeed(posts, {1: a, 2: b}, tips)
    expect(feed[0].tips.map((t) => t.hash)).toEqual(['t1', 't2'])
    expect(tipTotal(feed[0])).toBe(5)
    expect(tipTotal(feed[0].replies[0])).toBe(4)
  })

  it('puts the busiest thread first for the latest activity', () => {
    const posts = [
      post('p1', a, 'old post', 100),
      post('p2', b, 'newer post', 200),
      post('p3', c, 'a reply to the old post', 300, {replyTo: '1'}),
      post('p4', a, 'a comment under it', 400, {
        replyTo: '3',
        channel: 'discuss:3',
      }),
      post('p5', c, 'newest post', 450),
    ]
    const feed = socialFeed(posts, authorsOf(posts), [
      tip('t1', b, '2', '1', '1', 500),
    ])
    expect(sortFeed(feed, FeedSort.Newest).map((n) => n.id)).toEqual([5, 2, 1])
    expect(sortFeed(feed, FeedSort.Activity).map((n) => n.id)).toEqual([
      2, 5, 1,
    ])
    expect(lastActivityHeight(feed.find((n) => n.id === 1))).toBe(400)
    expect(sortFeed([], FeedSort.Activity)).toEqual([])
  })

  it('ranks the posts of a period by likes, answers or tips', () => {
    const posts = [
      post('p1', a, 'week old', 1000),
      post('p2', b, 'recent', 900000),
      post('p3', c, LIKE, 900010, {replyTo: '1'}),
      post('p4', c, LIKE, 900020, {replyTo: '2'}),
      post('p5', a, LIKE, 900030, {replyTo: '2'}),
      post('p6', c, 'answer', 900040, {replyTo: '1'}),
      post('p7', c, 'quiet post', 900050),
    ]
    const feed = socialFeed(posts, authorsOf(posts), [
      tip('t1', c, '1', '3', '3', 900060),
    ])
    expect(sortFeed(feed, FeedSort.Likes).map((n) => n.id)).toEqual([2, 1])
    expect(sortFeed(feed, FeedSort.Comments).map((n) => n.id)).toEqual([1])
    expect(sortFeed(feed, FeedSort.Tips).map((n) => n.id)).toEqual([1])
    expect(
      sortFeed(feed, FeedSort.Likes, {
        period: FeedPeriod.Week,
        now: 900100,
      }).map((n) => n.id)
    ).toEqual([2])
    expect(
      sortFeed(feed, FeedSort.Likes, {
        period: FeedPeriod.Epoch,
        epochStart: 900000,
      }).map((n) => n.id)
    ).toEqual([2])
    expect(
      sortFeed(feed, FeedSort.Likes, {period: FeedPeriod.Epoch}).map(
        (n) => n.id
      )
    ).toEqual([2, 1])
  })
})
