import {FlipType} from '../../../shared/types'
import {callRpc} from '../../../shared/utils/utils'
import {contentsKey} from './drafts'
import {
  deleteCost,
  deletePayload,
  flipsDecliners,
  flipsExecutors,
} from './execute'

jest.mock('../../../shared/utils/utils', () => ({
  ...jest.requireActual('../../../shared/utils/utils'),
  callRpc: jest.fn(),
}))

// To approve's Approve and Decline on a Flips step (B-258): on the draft as it is when clicked.

const t = (text) => text

function failedDraft() {
  const flip = {
    id: 'f',
    type: FlipType.Draft,
    keywordPairId: 2,
    keywords: {words: [{name: 'cat'}, {name: 'tree'}]},
    originalOrder: [0, 3, 1, 2],
    order: [2, 1, 3, 0],
    protectedImages: ['a', 'b', 'c', 'd'],
    agentFlip: {
      by: 'a1',
      stage: 'drafted',
      waiting: {step: 'flipDelete', id: 'item'},
      declined: {},
    },
  }
  return {
    ...flip,
    agentVerdict: {contents: contentsKey(flip), pass: false, waiting: null},
  }
}

function useStore(flips) {
  let list = flips
  global.flipStore = {
    getFlip: (id) => list.find((flip) => flip.id === id),
    updateDraft: (flip) => {
      list = list.map((one) => (one.id === flip.id ? {...one, ...flip} : one))
    },
    deleteDraft: jest.fn((id) => {
      list = list.map((one) =>
        one.id === id ? {...one, type: 'Removed'} : one
      )
    }),
  }
}

const item = {id: 'item', action: 'flipDelete', target: {flipId: 'f'}}

describe('Delete a draft in To approve', () => {
  afterEach(() => {
    delete global.flipStore
  })

  test('approved, the failed draft is deleted', async () => {
    useStore([failedDraft()])
    await flipsExecutors(t).flipDelete(item)
    expect(global.flipStore.getFlip('f').type).toBe('Removed')
  })

  test('a draft reworked since the judge failed it is not deleted', async () => {
    useStore([{...failedDraft(), order: [1, 2, 0, 3]}])
    await expect(flipsExecutors(t).flipDelete(item)).rejects.toThrow(
      'the draft changed since the judge failed it'
    )
    expect(global.flipStore.deleteDraft).not.toHaveBeenCalled()
  })

  test('declined, it is not proposed again on the same flip', async () => {
    useStore([failedDraft()])
    await flipsDecliners().flipDelete(item)
    const flip = global.flipStore.getFlip('f')
    expect(flip.type).toBe(FlipType.Draft)
    expect(flip.agentFlip.waiting).toBeNull()
    expect(flip.agentFlip.declined.flipDelete).toBe(contentsKey(flip))
  })
})

// B-277: a sent flip's deletion.
describe('Delete a sent flip', () => {
  const HASH = 'bafkreiaz6cqfg7fdja6bu563tuvfbzbhyljwe3vunjq3hligdbongtdrwq'
  // Field 1 of the flip's submit transaction mined on the devnet (bcn_transaction), the same CID bytes.
  const PAYLOAD =
    '0x0a240155122019f0a0537ca3483c1a77db9d2a50e427c2d3626eb46a61b3ad06185cd34c71b4'

  afterEach(() => {
    delete global.flipStore
    callRpc.mockReset()
  })

  test("its payload is the flip's CID as the node encodes it", () => {
    expect(deletePayload(HASH)).toBe(PAYLOAD)
    expect(() => deletePayload('not a cid')).toThrow()
  })

  test("its most is twice the node's estimate; an estimate without a fee is refused", async () => {
    const call = jest.fn(async (method) =>
      method === 'dna_getCoinbaseAddr' ? '0xme' : {txFee: '1.25'}
    )
    await expect(deleteCost({hash: HASH}, call)).resolves.toEqual({
      from: '0xme',
      payload: PAYLOAD,
      maxFee: 2.5,
    })
    expect(call).toHaveBeenCalledWith('bcn_estimateTx', [
      {type: 0xe, from: '0xme', payload: PAYLOAD},
    ])
    await expect(
      deleteCost({hash: HASH}, async () => ({txFee: '0'}))
    ).rejects.toThrow('the fee of the deletion is not known')
  })

  function sentFailed(fields = {}) {
    const flip = {
      id: 's',
      type: FlipType.Published,
      hash: HASH,
      txHash: '0xsent',
      keywordPairId: 2,
      originalOrder: [0, 3, 1, 2],
      order: [2, 1, 3, 0],
      protectedImages: ['a', 'b', 'c', 'd'],
      agentSent: {waiting: {step: 'flipDeleteSent', id: 'item'}},
      ...fields,
    }
    return {
      ...flip,
      agentVerdict: {contents: contentsKey(flip), pass: false, waiting: null},
    }
  }
  const sentItem = {
    id: 'item',
    action: 'flipDeleteSent',
    target: {flipId: 's', txHash: '0xsent'},
  }
  const node = () =>
    callRpc.mockImplementation(async (method) => {
      if (method === 'dna_getCoinbaseAddr') return '0xme'
      if (method === 'bcn_estimateTx') return {txFee: '1'}
      if (method === 'dna_sendTransaction') return '0xtx'
      throw new Error(method)
    })

  test('approved, the deletion is sent and the flip followed as being deleted', async () => {
    useStore([sentFailed()])
    node()
    await expect(flipsExecutors(t).flipDeleteSent(sentItem)).resolves.toBe(
      '0xtx'
    )
    expect(callRpc).toHaveBeenCalledWith('dna_sendTransaction', {
      type: 0xe,
      from: '0xme',
      payload: PAYLOAD,
      maxFee: 2,
    })
    expect(global.flipStore.getFlip('s')).toMatchObject({
      type: FlipType.Deleting,
      txHash: '0xtx',
      agentSent: {waiting: null},
    })
  })

  test('a sent flip whose verdict no longer holds is not deleted', async () => {
    useStore([{...sentFailed(), order: [1, 2, 3, 0]}])
    await expect(flipsExecutors(t).flipDeleteSent(sentItem)).rejects.toThrow(
      'the flip changed since the judge failed it'
    )
    expect(callRpc).not.toHaveBeenCalled()
  })

  test('declined, it is not proposed again on the same flip', async () => {
    useStore([sentFailed()])
    await flipsDecliners().flipDeleteSent(sentItem)
    const flip = global.flipStore.getFlip('s')
    expect(flip.type).toBe(FlipType.Published)
    expect(flip.agentSent).toEqual({waiting: null, declined: contentsKey(flip)})
  })

  test('a flip sent again since (another sending) is not deleted by the old item', async () => {
    useStore([sentFailed({txHash: '0xagain'})])
    node()
    await expect(flipsExecutors(t).flipDeleteSent(sentItem)).rejects.toThrow(
      'the flip was sent again since'
    )
    expect(callRpc).not.toHaveBeenCalledWith(
      'dna_sendTransaction',
      expect.anything()
    )
  })

  test('a deletion being sent already is not sent twice', async () => {
    useStore([
      sentFailed({
        agentSent: {
          waiting: {step: 'flipDeleteSent', id: 'item'},
          sending: true,
        },
      }),
    ])
    node()
    await expect(flipsExecutors(t).flipDeleteSent(sentItem)).rejects.toThrow(
      'its deletion is being sent already'
    )
  })

  test('sent, a failure to mark it after is said as sent (its count and cost stay)', async () => {
    useStore([sentFailed()])
    node()
    const update = global.flipStore.updateDraft
    global.flipStore.updateDraft = (flip) => {
      if (flip.type === FlipType.Deleting) throw new Error('disk full')
      update(flip)
    }
    const error = await flipsExecutors(t)
      .flipDeleteSent(sentItem)
      .catch((e) => e)
    expect(error.message).toBe('disk full')
    expect(error.sent).toBe(true)
    // Still marked as being sent: no run sends it again.
    expect(global.flipStore.getFlip('s').agentSent.sending).toBe(true)
  })

  test("approved, the judge's verdict on a sent flip holds", async () => {
    const flip = sentFailed({agentSent: undefined})
    flip.agentVerdict = {...flip.agentVerdict, waiting: 'verdict'}
    useStore([flip])
    await flipsExecutors(t).flipJudge({
      id: 'verdict',
      action: 'flipJudge',
      target: {flipId: 's'},
    })
    expect(global.flipStore.getFlip('s').agentVerdict.waiting).toBeNull()
  })
})

// B-284: a new story for a draft the judge failed, approved in To approve.
describe('A story written again in To approve', () => {
  afterEach(() => {
    delete global.flipStore
  })
  const story = {
    words: ['cat', 'tree'],
    stories: [{title: 'New', story: 'S', prompts: ['p1', 'p2', 'p3', 'p4']}],
  }
  const proposedDraft = () => {
    const flip = failedDraft()
    return {
      ...flip,
      images: ['i0', 'i1', 'i2', null],
      scenes: ['frames of the old pictures'],
      agentFlip: {
        ...flip.agentFlip,
        waiting: {step: 'flipStory', id: 'item'},
        proposed: {story, pictures: 4, by: 'a1'},
      },
    }
  }
  const storyItem = {id: 'item', action: 'flipStory', target: {flipId: 'f'}}

  test('approved, the draft takes the new story and loses its pictures and its verdict', async () => {
    useStore([proposedDraft()])
    await flipsExecutors(t).flipStory(storyItem)
    const flip = global.flipStore.getFlip('f')
    expect(flip.story).toBe(story)
    expect(flip.images).toEqual([null, null, null, null])
    expect(flip.protectedImages).toEqual([null, null, null, null])
    expect(flip.agentVerdict).toBeNull()
    expect(flip.scenes).toBeNull()
    expect(flip.adversarialImageId).toBe(-1)
    expect(flip.keywords.words).toHaveLength(2)
    expect(flip.agentFlip).toMatchObject({
      stage: 'story',
      waiting: null,
      rewrites: 1,
      lastFail: {pass: false},
    })
    expect(flip.agentFlip.proposed).toBeUndefined()
  })

  test('a draft reworked since the judge failed it keeps its story', async () => {
    useStore([{...proposedDraft(), order: [1, 2, 0, 3]}])
    await expect(flipsExecutors(t).flipStory(storyItem)).rejects.toThrow(
      'the draft changed since the judge failed it'
    )
    expect(global.flipStore.getFlip('f').images).toEqual([
      'i0',
      'i1',
      'i2',
      null,
    ])
  })

  test('declined, the draft stays as it was', async () => {
    useStore([proposedDraft()])
    await flipsDecliners().flipStory(storyItem)
    const flip = global.flipStore.getFlip('f')
    expect(flip.type).toBe(FlipType.Draft)
    expect(flip.images).toEqual(['i0', 'i1', 'i2', null])
    expect(flip.agentFlip.proposed).toBeNull()
    expect(global.flipStore.deleteDraft).not.toHaveBeenCalled()
  })
})
