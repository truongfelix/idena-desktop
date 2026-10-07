import {
  LIKE,
  MAX_INLINE_MEDIA,
  SOCIAL_FIRST_BLOCK,
  FeedSort,
  FeedPeriod,
  CACHE_VERSION,
  callsToActivity,
  checkNewBlocks,
  emptyCache,
  identityStatus,
  ipfsCid,
  lastActivityHeight,
  likeCount,
  nextPageToken,
  parsePost,
  parseTip,
  postAuthors,
  postIds,
  readCache,
  replyCount,
  scanOlderBlocks,
  scanState,
  scannedShare,
  socialFeed,
  socialProfile,
  sortFeed,
  timeAgo,
  tipTotal,
  validTipAmount,
  historyDone,
} from './utils'

// Ported from the phone app's SocialTest.kt: both apps read idena.social the same way.

const a = '0xaaaa000000000000000000000000000000000001'
const b = '0xbbbb000000000000000000000000000000000002'
const c = '0xcccc000000000000000000000000000000000003'

const hex = (text) => `0x${Buffer.from(text, 'utf8').toString('hex')}`

const call = (arg, extra = {}) => ({
  hash: '0x01',
  height: 7,
  timestamp: 1000,
  index: 2,
  from: '0xAAAA000000000000000000000000000000000001',
  amount: '0.00001',
  method: 'makePost',
  args: [hex(arg)],
  ...extra,
})

function post(
  hash,
  author,
  message,
  time,
  {replyTo = '', channel = '', height = time, index = 0, hasMedia = false} = {}
) {
  return {
    hash,
    height,
    time,
    index,
    author,
    message,
    replyTo,
    channel,
    hasMedia,
    media: '',
    mediaType: '',
  }
}

const tip = (hash, from, postId, tipAmount, amount, height, index = 0) => ({
  hash,
  height,
  time: height,
  index,
  from,
  postId,
  tipAmount,
  amount,
})

const authorsOf = (posts) =>
  Object.fromEntries(posts.map((p, i) => [i + 1, p.author]))

describe('reading the calls', () => {
  it('reads the argument idena.social sends', () => {
    const parsed = parsePost(
      call(
        '{"message":"hi","replyToPostId":"5","media":["AAAA"],"mediaType":["image/png"]}'
      )
    )
    expect(parsed).toMatchObject({
      hash: '0x01',
      height: 7,
      time: 1000,
      index: 2,
      message: 'hi',
      replyTo: '5',
      channel: '',
      hasMedia: true,
      author: a,
    })
    expect(parsePost(call('{"message":"x","media":["AAAA"]}')).hasMedia).toBe(
      false
    )
    expect(parsePost(call('hello'))).toBeNull()
    expect(parsePost(call('[1]'))).toBeNull()
    expect(parsePost({...call('{}'), args: []})).toBeNull()
  })

  it('keeps the first media', () => {
    const onIpfs = parsePost(
      call(
        '{"message":"","media":["ipfs://bafkreiabc123","x"],"mediaType":["image/png","image/gif"]}'
      )
    )
    expect(onIpfs.media).toBe('ipfs://bafkreiabc123')
    expect(onIpfs.mediaType).toBe('image/png')
    const big = 'A'.repeat(MAX_INLINE_MEDIA + 1)
    const tooLarge = parsePost(
      call(`{"message":"","media":["${big}"],"mediaType":["image/png"]}`)
    )
    expect(tooLarge.hasMedia).toBe(true)
    expect(tooLarge.media).toBe('')
  })

  it('reads tips and keeps posts and tips apart', () => {
    const parsed = parseTip(
      call('{"postId":"102","tipAmount":"5"}', {
        method: 'sendTip',
        from: '0xAB',
        amount: '5',
      })
    )
    expect(parsed).toMatchObject({
      postId: '102',
      tipAmount: '5',
      amount: '5',
      from: '0xab',
    })
    expect(validTipAmount(parsed)).toBe(5)

    const {posts, tips} = callsToActivity([
      call('{"message":"hi"}'),
      call('{"postId":"1","tipAmount":"2"}', {method: 'sendTip', amount: '2'}),
      call('{"message":"x"}', {method: 'sendMessage'}),
      call('not json'),
    ])
    expect(posts.map((p) => p.message)).toEqual(['hi'])
    expect(tips.map((t) => t.postId)).toEqual(['1'])
  })

  it('fetches only plain IPFS ids', () => {
    expect(
      ipfsCid(
        'ipfs://bafkreifcg3m5p24psikerh4eqi3yeyyfbkvyrzukitfi2s3o2p4wwrlzpe'
      )
    ).toBe('bafkreifcg3m5p24psikerh4eqi3yeyyfbkvyrzukitfi2s3o2p4wwrlzpe')
    expect(ipfsCid('ipfs://../../node/datadir/keystore')).toBeNull()
    expect(ipfsCid('ipfs://bafk rei')).toBeNull()
    expect(ipfsCid('bafkreifcg3m5p24psikerh4eqi3yeyyfb')).toBeNull()
    expect(ipfsCid('ipfs://')).toBeNull()
    expect(ipfsCid(undefined)).toBeNull()
  })
})

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

describe('a profile', () => {
  it('lists what its identity did', () => {
    const posts = [
      post('p1', a, "a's post", 100),
      post('p2', b, "b's reply", 110, {replyTo: '1'}),
      post('p3', a, LIKE, 120, {replyTo: '2', channel: 'discuss:2'}),
      post('p4', a, "a's comment on b's reply", 130, {
        replyTo: '2',
        channel: 'discuss:2',
      }),
      post('p5', c, "c's comment", 140, {replyTo: '2', channel: 'discuss:2'}),
      post('p6', a, "a answers c's comment", 150, {
        replyTo: '5',
        channel: 'discuss:2',
      }),
      post('p7', b, LIKE, 160, {replyTo: '1'}),
      post('p8', a, "a's reply with media", 170, {
        replyTo: '1',
        hasMedia: true,
      }),
      post('p9', b, "b's post", 180),
      post('p10', a, "a's second post", 190),
    ]
    const tips = [
      tip('t1', b, '1', '3', '3', 200),
      tip('t2', a, '9', '2', '2', 210),
      tip('t3', c, '5', '1', '1', 220),
    ]
    const profile = socialProfile(
      socialFeed(posts, authorsOf(posts), tips),
      a.toUpperCase().replace('0X', '0x')
    )
    expect(profile.address).toBe(a)
    expect(profile.posts.map((i) => i.node.id)).toEqual([10, 1])
    expect(profile.replies.map((i) => i.node.id)).toEqual([8])
    expect(profile.replies[0].parent.hash).toBe('p1')
    expect(profile.comments.map((i) => i.node.id)).toEqual([6, 4])
    expect(profile.comments[0].parent.hash).toBe('p5')
    expect(profile.comments[1].parent.hash).toBe('p2')
    expect(profile.likes.map((i) => i.node.call.hash)).toEqual(['p2'])
    expect(profile.likes[0].like.hash).toBe('p3')
    expect(profile.media.map((i) => i.node.id)).toEqual([8])
    expect(profile.tips.map((i) => i.tip.hash)).toEqual(['t2'])
    expect(profile.likesReceived).toBe(1)
    expect(profile.tipsReceived).toBe(3)
    expect(profile.tipsGiven).toBe(2)
    expect(
      new Set(
        [...profile.posts, ...profile.comments, ...profile.tips].map(
          (i) => i.threadId
        )
      )
    ).toEqual(new Set([1, 10, 9]))
  })

  it('is empty without posts', () => {
    const profile = socialProfile(
      socialFeed([post('p1', a, "a's post", 100)], {1: a}),
      c
    )
    expect(profile.posts).toEqual([])
    expect(profile.likes).toEqual([])
    expect(
      profile.likesReceived + profile.tipsReceived + profile.tipsGiven
    ).toBe(0)
    expect(socialProfile([], a).posts).toEqual([])
  })

  it('names identity states as idena.social does', () => {
    expect(identityStatus('Undefined')).toBe('Not validated')
    expect(identityStatus('')).toBe('Not validated')
    expect(identityStatus('Candidate')).toBe('Candidate')
  })
})

describe('times', () => {
  it('say how long ago, as Reddit', () => {
    expect(timeAgo(1000, 1005)).toBe('5s')
    expect(timeAgo(1000, 1000 + 600)).toBe('10min')
    expect(timeAgo(1000, 1000 + 7 * 3600)).toBe('7h')
    expect(timeAgo(1000, 1000 + 86400)).toBe('1d')
    expect(timeAgo(1000, 1000 + 150 * 86400)).toBe('5mo')
    expect(timeAgo(1000, 1000 + 2 * 365 * 86400)).toBe('2y')
    expect(timeAgo(1000, 900)).toBe('now')
  })
})

describe('the contract map', () => {
  it('gives the post authors', () => {
    // An item of contract_iterateMap(idena.social, "p:", ..., "hex", "hex") on mainnet: post 1.
    const items = [
      {
        key: '0x01000000000000000000000000000000',
        value:
          '0x307862313262313232326430636537306430336264393834613836316338323561383661633637383938',
      },
      {key: '0x66000000000000000000000000000000', value: hex('0xABC')},
      {key: '0x00010000000000000000000000000000', value: hex('0xdef')},
    ]
    expect(postAuthors(items)).toEqual({
      1: '0xb12b1222d0ce70d03bd984a861c825a86ac67898',
      102: '0xabc',
      256: '0xdef',
    })
  })

  it('ends at the last page', () => {
    expect(nextPageToken('0x703a65000000000000000000000000000000')).toBe(
      '0x703a65000000000000000000000000000000'
    )
    expect(nextPageToken('0x')).toBeNull()
    expect(nextPageToken('')).toBeNull()
    expect(nextPageToken(null)).toBeNull()
  })
})

/** A node whose head moves as `heads` says, one value per head() call (the last one repeats). */
function fakeSource(heads, postsAt = {}, batch = 500) {
  let headCalls = 0
  const source = {
    ranges: [],
    authorReads: 0,
    batchSize: () => batch,
    head: async () => {
      const head = heads[Math.min(headCalls, heads.length - 1)]
      headCalls += 1
      return head
    },
    calls: async (from, to) => {
      source.ranges.push([from, to])
      const posts = []
      for (let h = from; h <= to; h += 1) if (postsAt[h]) posts.push(postsAt[h])
      return {posts, tips: []}
    },
    authors: async () => {
      source.authorReads += 1
      return {1: `0x${source.authorReads}`}
    },
  }
  return source
}

describe('the scan', () => {
  it('starts at the head the first time', async () => {
    const source = fakeSource([12000000])
    const cache = await checkNewBlocks(null, source)
    expect(source.ranges).toEqual([])
    expect(cache.low).toBe(12000001)
    expect(cache.high).toBe(12000000)
    expect(cache.authorsHeight).toBe(12000000)
    expect(scannedShare(cache)).toBe(0)
  })

  it('reads new blocks in batches up to the head', async () => {
    const start = {...emptyCache(11000000), authorsHeight: 11000000}
    const source = fakeSource([11001200], {
      11000700: post('h', a, 'hi', 1, {height: 11000700}),
    })
    let saves = 0
    const cache = await checkNewBlocks(start, source, {
      save: () => {
        saves += 1
      },
    })
    expect(source.ranges).toEqual([
      [11000001, 11000500],
      [11000501, 11001000],
      [11001001, 11001200],
    ])
    expect(cache.high).toBe(11001200)
    expect(cache.authorsHeight).toBe(11001200)
    expect(cache.posts.map((p) => p.hash)).toEqual(['h'])
    expect(saves).toBe(4)
  })

  it('keeps its batches and the old authors when stopped', async () => {
    const start = {...emptyCache(1000), authors: {1: a}, authorsHeight: 1000}
    const source = fakeSource([2200])
    let batches = 0
    const cache = await checkNewBlocks(start, source, {
      keepGoing: () => {
        batches += 1
        return batches <= 2
      },
    })
    expect(source.ranges).toEqual([
      [1001, 1500],
      [1501, 2000],
    ])
    expect(cache.high).toBe(2000)
    expect(source.authorReads).toBe(0)
    expect(cache.authorsHeight).toBe(1000)
    expect(cache.authors).toEqual({1: a})
  })

  it('takes the authors only at a stable head', async () => {
    const start = {...emptyCache(100), authorsHeight: 100}
    // The head moves from 110 to 111 while the authors are read: the new block is read first.
    const source = fakeSource([110, 111, 111, 111])
    const cache = await checkNewBlocks(start, source)
    expect(source.ranges).toEqual([
      [101, 110],
      [111, 111],
    ])
    expect(cache.authorsHeight).toBe(111)
    expect(cache.authors).toEqual({1: '0x2'})
  })

  it('stops the history at the contract first block', async () => {
    let cache = {
      ...emptyCache(SOCIAL_FIRST_BLOCK + 800),
      low: SOCIAL_FIRST_BLOCK + 700,
    }
    const source = fakeSource([0])
    cache = await scanOlderBlocks(cache, source)
    cache = await scanOlderBlocks(cache, source)
    cache = await scanOlderBlocks(cache, source)
    expect(source.ranges).toEqual([
      [SOCIAL_FIRST_BLOCK + 200, SOCIAL_FIRST_BLOCK + 699],
      [SOCIAL_FIRST_BLOCK, SOCIAL_FIRST_BLOCK + 199],
    ])
    expect(historyDone(cache)).toBe(true)
    expect(scannedShare(cache)).toBe(1)
  })

  it('keeps nothing of a failed batch', async () => {
    const start = {...emptyCache(1000), authorsHeight: 1000}
    const source = {
      ...fakeSource([1600]),
      calls: async () => {
        throw new Error('the node dropped the request')
      },
    }
    await expect(checkNewBlocks(start, source)).rejects.toThrow('dropped')
    const old = {
      ...emptyCache(SOCIAL_FIRST_BLOCK + 800),
      low: SOCIAL_FIRST_BLOCK + 700,
    }
    await expect(scanOlderBlocks(old, source)).rejects.toThrow('dropped')
  })

  it('uses a saved cache of its version and contract only', () => {
    const cache = emptyCache(11000000)
    expect(readCache(JSON.parse(JSON.stringify(cache)))).toEqual(cache)
    expect(readCache({...cache, version: CACHE_VERSION + 1})).toBeNull()
    expect(readCache({...cache, contract: '0x0'})).toBeNull()
    expect(readCache(null)).toBeNull()
  })
})

describe('the scan state', () => {
  const node = {peers: 5, syncing: false, validation: false}
  const done = {
    ...emptyCache(11000000),
    low: SOCIAL_FIRST_BLOCK,
    authorsHeight: 11000000,
  }

  it('follows the node and the scan', () => {
    expect(scanState(node, 11000000, done)).toEqual({
      health: 'good',
      kind: 'upToDate',
    })
    expect(scanState(node, 11000003, done).health).toBe('good')
    expect(scanState(node, 11000004, done)).toEqual({
      health: 'warn',
      kind: 'behind',
      behind: 4,
    })
    expect(scanState({...node, peers: 0}, 11000000, done).kind).toBe('noPeers')
    expect(scanState(null, null, done).health).toBe('bad')
    expect(scanState({...node, syncing: true}, 11000000, done).kind).toBe(
      'syncing'
    )
    expect(scanState({...node, validation: true}, 11000000, done).health).toBe(
      'off'
    )
    expect(scanState(node, 11000000, null).kind).toBe('starting')
    const half = {
      ...done,
      low: SOCIAL_FIRST_BLOCK + (11000000 - SOCIAL_FIRST_BLOCK) / 2,
    }
    expect(scanState(node, 11000000, half)).toMatchObject({
      kind: 'history',
      share: expect.closeTo(0.5, 2),
    })
  })
})
