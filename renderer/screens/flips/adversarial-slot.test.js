import {interpret, State} from 'xstate'
import {flipMasterMachine} from './machines'
import {placeAdversarial} from './utils'

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

describe('placeAdversarial', () => {
  it('moves the nonsense picture from the last slot to a random one', () => {
    expect(
      placeAdversarial(
        {originalOrder: [0, 1, 2, 3], adversarialImageId: 3},
        () => 0
      )
    ).toEqual({originalOrder: [3, 0, 1, 2], order: [3, 0, 1, 2]})
    expect(
      placeAdversarial(
        {originalOrder: [0, 1, 2, 3], adversarialImageId: 3},
        () => 0.6
      )
    ).toEqual({originalOrder: [0, 1, 3, 2], order: [0, 1, 3, 2]})
  })

  it('keeps a slot the user chose, and a flip without one', () => {
    expect(
      placeAdversarial({originalOrder: [0, 3, 1, 2], adversarialImageId: 3})
    ).toEqual({})
    expect(
      placeAdversarial({originalOrder: [0, 1, 2, 3], adversarialImageId: -1})
    ).toEqual({})
  })
})

// B-210: the nonsense picture used to move on the way to Protect, behind the user's back.
describe('the nonsense picture in the flip master', () => {
  let random
  beforeEach(() => {
    random = jest.spyOn(Math, 'random').mockReturnValue(0)
  })
  afterEach(() => random.mockRestore())

  // A flip at its story step.
  function start(context = {}) {
    const machine = flipMasterMachine
      .withConfig({
        services: {
          loadKeywords: () => new Promise(() => {}),
          loadTranslations: () => new Promise(() => {}),
          loadAdversarial: async () => {},
          persistFlip: () => () => {},
          protectFlip: async ({images}) => ({
            protectedImages: images.map((x) => x && `p-${x}`),
            adversarialImage: 'nonsense',
          }),
        },
      })
      .withContext({
        ...flipMasterMachine.context,
        images: ['a', 'b', 'c', undefined],
        ...context,
      })
    const service = interpret(machine).start(
      machine.resolveState(
        State.from({editing: {keywords: 'loading'}}, machine.context)
      )
    )
    return {service}
  }

  it('gets its slot when the editor opens, and keeps it on Protect and back', async () => {
    const {service} = start()
    service.send('NEXT')
    await settle()
    const placed = service.state.context.originalOrder
    expect(placed).toEqual([3, 0, 1, 2])
    expect(service.state.context.adversarialPlaced).toBe(true)

    service.send('NEXT')
    await settle()
    expect(service.state.matches({editing: 'protect'})).toBe(true)
    expect(service.state.context.originalOrder).toEqual(placed)

    service.send('PREV')
    await settle()
    expect(service.state.context.originalOrder).toEqual(placed)
    service.stop()
  })

  it('keeps the last slot when the user put it there', async () => {
    const {service} = start()
    service.send('NEXT')
    await settle()
    service.send({type: 'CHANGE_ORIGINAL_ORDER', order: [0, 1, 2, 3]})
    await settle()
    service.send('NEXT')
    await settle()
    expect(service.state.matches({editing: 'protect'})).toBe(true)
    expect(service.state.context.originalOrder).toEqual([0, 1, 2, 3])
    service.stop()
  })

  it('keeps the last slot the user chose after Protect and back', async () => {
    const {service} = start()
    service.send('NEXT')
    await settle()
    service.send({type: 'CHANGE_ORIGINAL_ORDER', order: [0, 1, 2, 3]})
    await settle()
    service.send('NEXT')
    await settle()
    service.send('PREV')
    await settle()
    expect(service.state.matches({editing: 'images'})).toBe(true)
    expect(service.state.context.originalOrder).toEqual([0, 1, 2, 3])
    service.stop()
  })

  it('keeps the order of an older draft already shuffled', async () => {
    const {service} = start({
      originalOrder: [0, 1, 2, 3],
      order: [2, 0, 3, 1],
      orderPermutations: [2, 0, 3, 1],
    })
    service.send('NEXT')
    await settle()
    expect(service.state.context.originalOrder).toEqual([0, 1, 2, 3])
    expect(service.state.context.order).toEqual([2, 0, 3, 1])
    expect(service.state.context.orderPermutations).toEqual([2, 0, 3, 1])
    expect(service.state.context.adversarialPlaced).toBe(true)
    service.stop()
  })

  it('leaves a draft placed before as it is', async () => {
    const {service} = start({
      originalOrder: [0, 1, 2, 3],
      order: [0, 1, 2, 3],
      adversarialPlaced: true,
    })
    service.send('NEXT')
    await settle()
    expect(service.state.context.originalOrder).toEqual([0, 1, 2, 3])
    service.stop()
  })
})
