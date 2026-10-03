import {createMachine, interpret} from 'xstate'

// The context bridge copies what the renderer passes: prototypes dropped, cycles kept. lowdb then writes it with
// JSON.stringify. This copies the same way.
function bridgeCopy(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const copy = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  for (const key of Object.keys(value)) {
    if (typeof value[key] !== 'function')
      copy[key] = bridgeCopy(value[key], seen)
  }
  return copy
}

function loadUtilsWithBridgeStore() {
  jest.resetModules()
  const store = {}
  global.logger = {error: jest.fn()}
  global.persistentState = {
    getState: (name) => store[name] ?? {},
    set: jest.fn(),
    setState: (name, value) => {
      store[name] = JSON.parse(JSON.stringify(bridgeCopy(value)))
    },
  }
  // eslint-disable-next-line global-require
  return {utils: require('./utils'), store}
}

const machine = createMachine({
  id: 'validation',
  initial: 'shortSession',
  context: {epoch: 229, reports: new Set(), answers: []},
  states: {
    shortSession: {
      initial: 'solve',
      states: {solve: {on: {SUBMIT: 'submitted'}}, submitted: {}},
      on: {LONG: 'longSession'},
    },
    longSession: {initial: 'keywords', states: {keywords: {}}},
  },
})

describe('validation state through the bridge', () => {
  it('is saved and restored', () => {
    const {utils, store} = loadUtilsWithBridgeStore()
    const service = interpret(machine).start()
    service.send('LONG')
    const {state} = service
    state.context.reports.add('flip-3')
    state.context.answers.push({hash: 'flip-1', option: 2})

    utils.persistValidationState(state)
    expect(global.logger.error).not.toHaveBeenCalled()
    expect(store.validation2).toBeDefined()

    const restored = utils.loadValidationState()
    expect(restored.value).toEqual({longSession: 'keywords'})
    expect(restored.context.epoch).toBe(229)
    expect(restored.context.answers).toEqual([{hash: 'flip-1', option: 2}])
    expect([...restored.context.reports]).toEqual(['flip-3'])
    service.stop()
  })

  it('fails the old way: the State itself cannot be written', () => {
    const service = interpret(machine).start()
    expect(() =>
      JSON.stringify(bridgeCopy({...service.state, context: {}}))
    ).toThrow(/circular/)
    service.stop()
  })
})
