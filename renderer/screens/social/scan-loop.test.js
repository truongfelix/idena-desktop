import {emptyCache} from './scan'
import {runSocialScan} from './scan-loop'
import {CURRENT_VERSION, HISTORY_START} from './versions'

jest.mock('./storage', () => ({saveSocialCache: async () => {}}))

const missing = (method) =>
  new Error(`the method ${method} does not exist/is not available`)

/**
 * A node at `head`: while `starting()` it refuses every method, as a node that starts does; `hasSocial` false is a
 * node without the idena.social methods (an official node).
 */
function scriptedNode({head, starting = () => false, hasSocial = true}) {
  const source = {
    reads: [],
    batchSize: () => 500,
    head: async () => {
      if (starting()) throw missing('bcn_lastBlock')
      return head
    },
    calls: async (from, to) => {
      if (starting()) throw missing('bcn_blocksWithAddress')
      if (!hasSocial) throw missing('bcn_contractCalls')
      source.reads.push([from, to])
      return {posts: [], tips: []}
    },
    authors: async () => ({}),
  }
  const rpc = async (method) => {
    if (starting()) throw missing(method)
    if (method === 'net_peers') return [{}, {}]
    if (method === 'dna_version') return '1.1.2'
    throw missing(method)
  }
  return {source, rpc}
}

/**
 * Runs the scan, its history read and its new blocks 100 blocks behind the node's head, until it has paused `turns`
 * times.
 */
async function run(node, turns, onPause = () => {}) {
  const cacheRef = {
    current: {
      ...emptyCache(node.head - 100),
      low: HISTORY_START,
      messagesLow: CURRENT_VERSION.from,
    },
  }
  const reported = {missingMethod: [], error: []}
  const pauses = []
  await runSocialScan({
    source: node.source,
    rpc: node.rpc,
    cacheRef,
    isPageOpen: () => true,
    pause: async (ms) => {
      pauses.push(ms)
      onPause(pauses.length)
    },
    save: async (next) => {
      cacheRef.current = next
    },
    stopped: () => pauses.length >= turns,
    report: {
      head: () => {},
      peers: () => {},
      error: (error) => reported.error.push(error),
      missingMethod: (value) => reported.missingMethod.push(value),
    },
  })
  return {cacheRef, reported, pauses}
}

describe('the scan loop', () => {
  it('reads again once a node that was starting answers', async () => {
    // B-126: the node restarts under the scan and refuses every method for two rounds.
    let starting = true
    const node = {
      head: 12000000,
      ...scriptedNode({head: 12000000, starting: () => starting}),
    }
    const {cacheRef, reported, pauses} = await run(node, 4, (n) => {
      if (n === 2) starting = false
    })
    expect(reported.missingMethod).not.toContain(true)
    expect(node.source.reads).toEqual([[11999901, 12000000]])
    expect(cacheRef.current.high).toBe(12000000)
    expect(reported.error.at(-1)).toBeNull()
    expect(pauses).toEqual([15000, 15000, 20000, 20000])
  })

  it('tells a node without the idena.social methods, and asks it again later', async () => {
    const node = {
      head: 12000000,
      ...scriptedNode({head: 12000000, hasSocial: false}),
    }
    const {reported, pauses} = await run(node, 2)
    expect(reported.missingMethod).toEqual([true, true])
    expect(pauses).toEqual([60000, 60000])
  })
})
