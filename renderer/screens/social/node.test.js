import {
  socialRpc,
  BLOCKS_PER_CALL,
  FIRST_BATCH,
  MAX_BATCH,
  MIN_BATCH,
  isMissingMethod,
  nodeSocialSource,
} from './node'
import {SOCIAL_CONTRACT} from './contract'

const hex = (text) => `0x${Buffer.from(text, 'utf8').toString('hex')}`

/** A node answering by method; `delays` (seconds) moves the clock during bcn_blocksWithAddress. */
function scriptedNode(answers, delays = []) {
  let clock = 0
  const requests = []
  const call = async (method, params) => {
    requests.push({method, params})
    if (method === 'bcn_blocksWithAddress')
      clock += (delays.shift() || 0) * 1000
    const answer = answers[method]
    return typeof answer === 'function' ? answer(...(params || [])) : answer
  }
  return {call, requests, now: () => clock}
}

const makePost = (height, message) => ({
  height,
  timestamp: height,
  index: 0,
  hash: `0x${height}`,
  from: '0xAA',
  amount: '0.00001',
  method: 'makePost',
  args: [hex(JSON.stringify({message}))],
})

describe('the node source', () => {
  it('reads the calls of the blocks the filter finds, a few blocks per call', async () => {
    const heights = Array.from({length: 19}, (_, i) => 100 + i)
    const node = scriptedNode({
      bcn_blocksWithAddress: heights,
      bcn_contractCalls: ({heights: asked}) =>
        asked.map((h) => makePost(h, `post ${h}`)),
    })
    const {posts, tips} = await nodeSocialSource(node.call, node.now).calls(
      100,
      200
    )
    expect(posts).toHaveLength(19)
    expect(tips).toEqual([])
    expect(node.requests[0]).toEqual({
      method: 'bcn_blocksWithAddress',
      params: [{address: SOCIAL_CONTRACT, from: 100, to: 200}],
    })
    const chunks = node.requests
      .filter(({method}) => method === 'bcn_contractCalls')
      .map(({params: [{contract, heights: asked}]}) => {
        expect(contract).toBe(SOCIAL_CONTRACT)
        return asked.length
      })
    expect(chunks).toEqual([BLOCKS_PER_CALL, BLOCKS_PER_CALL, 3])
  })

  it('asks for no calls without blocks', async () => {
    const node = scriptedNode({bcn_blocksWithAddress: []})
    expect(await nodeSocialSource(node.call, node.now).calls(1, 2)).toEqual({
      posts: [],
      tips: [],
    })
    expect(node.requests.map(({method}) => method)).toEqual([
      'bcn_blocksWithAddress',
    ])
  })

  it('checks more blocks while the node is quick, fewer when it is slow', async () => {
    const node = scriptedNode({bcn_blocksWithAddress: []}, [1, 1, 1, 1, 45, 15])
    const source = nodeSocialSource(node.call, node.now)
    expect(source.batchSize()).toBe(FIRST_BATCH)
    await source.calls(1, 2)
    expect(source.batchSize()).toBe(FIRST_BATCH * 2)
    await source.calls(1, 2)
    await source.calls(1, 2)
    await source.calls(1, 2)
    expect(source.batchSize()).toBe(MAX_BATCH)
    await source.calls(1, 2)
    expect(source.batchSize()).toBe(MAX_BATCH / 2)
    await source.calls(1, 2)
    expect(source.batchSize()).toBe(MAX_BATCH / 2)
  })

  it('checks fewer blocks after a failed call, down to a floor', async () => {
    const node = scriptedNode({
      bcn_blocksWithAddress: () => {
        throw new Error('Failed to fetch')
      },
    })
    const source = nodeSocialSource(node.call, node.now)
    for (let i = 0; i < 6; i += 1)
      // eslint-disable-next-line no-await-in-loop
      await expect(source.calls(1, 2)).rejects.toThrow('Failed to fetch')
    expect(source.batchSize()).toBe(MIN_BATCH)
  })

  it('tells a node without the methods', async () => {
    const missing = new Error(
      'the method bcn_contractCalls does not exist/is not available'
    )
    expect(isMissingMethod(missing)).toBe(true)
    expect(isMissingMethod(new Error('Failed to fetch'))).toBe(false)
    const node = scriptedNode({
      bcn_blocksWithAddress: () => {
        throw missing
      },
    })
    const source = nodeSocialSource(node.call, node.now)
    await expect(source.calls(1, 2)).rejects.toBe(missing)
    expect(source.batchSize()).toBe(FIRST_BATCH)
  })

  it('reads the post authors page by page', async () => {
    const pages = {
      null: {
        items: [
          {key: '0x01000000000000000000000000000000', value: hex('0xAA')},
        ],
        continuationToken: '0x01',
      },
      '0x01': {
        items: [
          {key: '0x02000000000000000000000000000000', value: hex('0xbb')},
        ],
        continuationToken: '0x',
      },
    }
    const node = scriptedNode({
      contract_iterateMap: (contract, prefix, token) => {
        expect(contract).toBe(SOCIAL_CONTRACT)
        expect(prefix).toBe('p:')
        return pages[token]
      },
    })
    expect(await nodeSocialSource(node.call, node.now).authors()).toEqual({
      1: '0xaa',
      2: '0xbb',
    })
  })

  it('stops when the map pages repeat', async () => {
    const node = scriptedNode({
      contract_iterateMap: () => ({items: [], continuationToken: '0x01'}),
    })
    await expect(
      nodeSocialSource(node.call, node.now).authors()
    ).rejects.toThrow('repeats')
  })

  it('takes the head from the last block', async () => {
    const node = scriptedNode({bcn_lastBlock: {height: 11407000}})
    expect(await nodeSocialSource(node.call, node.now).head()).toBe(11407000)
  })
})

describe('a node call', () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.fetch
  })

  it('gives up after its timeout with an error that says so', async () => {
    jest.useFakeTimers()
    global.fetch = jest.fn(
      (url, {signal}) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new Error('signal is aborted without reason'))
          )
        })
    )
    const pending = socialRpc('bcn_blocksWithAddress', [], 5000)
    jest.advanceTimersByTime(5000)
    await expect(pending).rejects.toMatchObject({
      timeout: true,
      message: 'bcn_blocksWithAddress: no answer within 5 s',
    })
  })

  it("passes the node's error on", async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({error: {message: 'block 5 cannot be read'}}),
    }))
    await expect(socialRpc('bcn_contractCalls', [])).rejects.toThrow(
      'block 5 cannot be read'
    )
    global.fetch = jest.fn(async () => ({json: async () => ({result: 7})}))
    expect(await socialRpc('bcn_lastBlock')).toBe(7)
  })
})
