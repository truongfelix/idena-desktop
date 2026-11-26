import {State} from 'xstate'
import {draftOf, flipMasterMachine} from './machines'
import {FlipType} from '../../shared/types'

// B-236 (owner 2026-11-15): the story an agent wrote for a flip is kept in its draft, which it creates when there is
// none yet (the keywords step comes before any picture).

const STORY = {
  title: 'The Kite',
  prompts: ['p1', 'p2', 'p3'],
  words: ['ladder', 'kite'],
}

function editing(step, context = {}) {
  const machine = flipMasterMachine.withContext({
    ...flipMasterMachine.context,
    ...context,
  })
  return {
    machine,
    state: machine.resolveState(
      // The keywords step has no idle state: its atomic failure state stands in.
      State.from(
        {editing: {[step]: step === 'keywords' ? 'failure' : 'idle'}},
        machine.context
      )
    ),
  }
}

describe("a flip's story in its draft", () => {
  let store
  beforeEach(() => {
    const flips = []
    store = {
      flips,
      getFlip: jest.fn((id) => flips.find((f) => f.id === id)),
      addDraft: jest.fn((d) => flips.push(d)),
      updateDraft: jest.fn((d) => {
        const i = flips.findIndex((f) => f.id === d.id)
        flips[i] = {...flips[i], ...d}
      }),
    }
    global.flipStore = store
  })
  afterEach(() => {
    delete global.flipStore
  })

  const run = (machine, next) =>
    next.actions
      .filter(({type}) => type === 'persistStory')
      .forEach(() => machine.options.actions.persistStory(next.context))

  it('a story on a new flip makes its draft, with the story', () => {
    const {machine, state} = editing('keywords', {keywordPairId: 4})
    expect(state.context.id).toBeUndefined()
    const next = machine.transition(state, {type: 'CHANGE_STORY', story: STORY})
    run(machine, next)
    expect(next.context.id).toEqual(expect.any(String))
    expect(next.context.type).toBe(FlipType.Draft)
    expect(store.addDraft).toHaveBeenCalledTimes(1)
    expect(store.flips[0]).toMatchObject({
      id: next.context.id,
      type: FlipType.Draft,
      keywordPairId: 4,
      story: STORY,
    })
  })

  it('another story replaces it in the same draft, from any step', () => {
    const {machine, state} = editing('images', {id: 'f1', type: FlipType.Draft})
    store.flips.push({
      id: 'f1',
      type: FlipType.Draft,
      images: ['a'],
      story: STORY,
    })
    const other = {...STORY, title: 'Another'}
    const next = machine.transition(state, {type: 'CHANGE_STORY', story: other})
    run(machine, next)
    expect(store.addDraft).not.toHaveBeenCalled()
    expect(store.flips).toHaveLength(1)
    expect(store.flips[0].story.title).toBe('Another')
    expect(next.context.id).toBe('f1')
  })

  it('a picture saved after it keeps the story in the draft', () => {
    expect(draftOf({id: 'f1', story: STORY, images: []}).story).toBe(STORY)
  })

  it('a new flip starts with no story', () => {
    expect(flipMasterMachine.context.story).toBeNull()
  })
})
