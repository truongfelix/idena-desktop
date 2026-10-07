import {SOCIAL_FIRST_BLOCK} from './contract'
import {
  CACHE_VERSION,
  checkNewBlocks,
  emptyCache,
  historyDone,
  readCache,
  scannedShare,
  scanOlderBlocks,
  scanState,
} from './scan'
import {a, post} from './test-helpers'

// Ported from the phone app's SocialTest.kt: both apps read idena.social the same way.

/** A node whose head moves as `heads` says, one value per head() call (the last one repeats). */
function scriptedSource(heads, postsAt = {}, batch = 500) {
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
    const source = scriptedSource([12000000])
    const cache = await checkNewBlocks(null, source)
    expect(source.ranges).toEqual([])
    expect(cache.low).toBe(12000001)
    expect(cache.high).toBe(12000000)
    expect(cache.authorsHeight).toBe(12000000)
    expect(scannedShare(cache)).toBe(0)
  })

  it('reads new blocks in batches up to the head', async () => {
    const start = {...emptyCache(11000000), authorsHeight: 11000000}
    const source = scriptedSource([11001200], {
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
    const source = scriptedSource([2200])
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
    const source = scriptedSource([110, 111, 111, 111])
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
    const source = scriptedSource([0])
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
      ...scriptedSource([1600]),
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
