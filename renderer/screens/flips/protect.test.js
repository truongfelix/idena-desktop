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
