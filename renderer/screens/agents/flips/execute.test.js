import {FlipType} from '../../../shared/types'
import {contentsKey} from './drafts'
import {flipsDecliners, flipsExecutors} from './execute'

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
