import {State} from 'xstate'
import {flipMasterMachine} from './machines'

// The Protect step: "protecting" disables Prev and Next; it must be left when protection gives no image.
function protectingState() {
  const machine = flipMasterMachine.withContext({
    ...flipMasterMachine.context,
    images: ['a', 'b', 'c', 'd'],
    protectedImages: ['pa', undefined, undefined, undefined],
  })
  return {
    machine,
    state: machine.resolveState(
      State.from({editing: {protect: 'protecting'}}, machine.context)
    ),
  }
}

describe('flip Protect step', () => {
  it('leaves "protecting" when protection gives no image', () => {
    const {machine, state} = protectingState()
    expect(state.matches({editing: {protect: 'protecting'}})).toBe(true)
    const next = machine.transition(state, 'PROTECT_FAILED')
    expect(next.matches({editing: {protect: 'protecting'}})).toBe(false)
    expect(next.matches({editing: 'protect'})).toBe(true)
  })

  it('still leaves it with a protected image', () => {
    const {machine, state} = protectingState()
    const next = machine.transition(state, {
      type: 'CHANGE_PROTECTED_IMAGES',
      image: 'pb',
      currentIndex: 1,
    })
    expect(next.matches({editing: {protect: 'protecting'}})).toBe(false)
    expect(next.context.protectedImages[1]).toBe('pb')
  })
})

// B-213: the Protect step's controls start at each picture's noise.
describe('the noise of each protected picture', () => {
  it('keeps the effects that came with a changed picture, and leaves the others', () => {
    const {machine, state} = protectingState()
    const effects = {mirror: true, grain: 35, hue: 25}
    const next = machine.transition(state, {
      type: 'CHANGE_PROTECTED_IMAGES',
      image: 'pb',
      currentIndex: 1,
      effects,
    })
    expect(next.context.noise[1]).toEqual(effects)
    expect(next.context.noise[0]).toBeUndefined()
  })
})

describe('the nonsense picture and the noise in the draft', () => {
  it('drops the nonsense source when a story picture changes', () => {
    const machine = flipMasterMachine.withContext({
      ...flipMasterMachine.context,
      adversarialImage: 'old-nonsense',
    })
    const state = machine.resolveState(
      State.from({editing: {images: 'idle'}}, machine.context)
    )
    const next = machine.transition(state, {
      type: 'CHANGE_IMAGES',
      image: 'new-picture',
      currentIndex: 0,
    })
    expect(next.context.adversarialImage).toBe('')
  })

  it('saves each picture noise with the draft', () => {
    const saved = []
    global.flipStore = {
      updateDraft: (flip) => saved.push(flip),
      addDraft: (flip) => saved.push(flip),
      getFlips: () => [],
    }
    const noise = [{mirror: true, grain: 25, hue: 40}]
    const persist = flipMasterMachine.options.services.persistFlip(
      {...flipMasterMachine.context, id: 'f1', noise},
      {type: 'CHANGE_ORDER'}
    )
    persist(() => {})
    expect(saved.at(-1).noise).toEqual(noise)
  })
})
