import {interpret} from 'xstate'
import {flipMasterMachine} from './machines'
import {newFlipKeywords} from './utils'
import {FlipType} from '../../shared/types'

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

// B-201: a New flip opened before the identity loaded stayed a blank page.
describe('preparing a flip', () => {
  it('leaves "prepare" when it fails, and prepares again on retry', async () => {
    let calls = 0
    const service = interpret(
      flipMasterMachine.withConfig({
        services: {
          prepareFlip: async () => {
            calls += 1
            if (calls === 1) throw new Error('The identity is not loaded yet')
            return {keywordPairId: 0, availableKeywords: []}
          },
          loadKeywords: () => new Promise(() => {}),
        },
      })
    )
    service.start()
    service.send({type: 'SET_EPOCH_NUMBER', epochNumber: 1})
    await settle()
    expect(service.state.matches('prepareFailed')).toBe(true)

    service.send('RETRY')
    await settle()
    expect(calls).toBe(2)
    expect(service.state.matches('editing')).toBe(true)
    service.stop()
  })
})

describe('newFlipKeywords', () => {
  const pairs = [
    {id: 1, used: true},
    {id: 2, used: false},
    {id: 3, used: false},
  ]

  it('gives a random pair when no pair is left', () => {
    const pendingBoth = [
      {type: FlipType.Publishing, keywordPairId: 2},
      {type: FlipType.Publishing, keywordPairId: 3},
    ]
    const {keywordPairId, availableKeywords} = newFlipKeywords(
      pairs,
      pendingBoth
    )
    expect(keywordPairId).toBe(0)
    expect(availableKeywords).toHaveLength(1)
  })

  it('reads a missing flip list as empty', () => {
    expect(newFlipKeywords(pairs, undefined).keywordPairId).toBe(2)
  })

  it('gives a random pair to an identity without pairs', () => {
    for (const none of [null, undefined, [{id: 1, used: true}]]) {
      const {keywordPairId, availableKeywords} = newFlipKeywords(none, [])
      expect(keywordPairId).toBe(0)
      expect(availableKeywords).toHaveLength(1)
    }
  })

  it('offers the pairs neither used nor in a pending flip', () => {
    const pending = [{type: FlipType.Publishing, keywordPairId: 2}]
    const {keywordPairId, availableKeywords} = newFlipKeywords(pairs, pending)
    expect(availableKeywords.map(({id}) => id)).toEqual([3])
    expect(keywordPairId).toBe(3)
  })
})
