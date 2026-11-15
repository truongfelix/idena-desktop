import {foldKey, readFold, writeFold} from './fold'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (k) => (values.has(k) ? values.get(k) : null),
    setItem: (k, v) => values.set(k, String(v)),
  }
}

describe('a folding section remembers its state (B-250)', () => {
  test('its default until the person folds or opens it', () => {
    const storage = memoryStorage()
    expect(readFold(storage, 'agent.task', true)).toBe(true)
    expect(readFold(storage, 'agent.reportRules', false)).toBe(false)
    writeFold(storage, 'agent.task', false)
    writeFold(storage, 'agent.reportRules', true)
    expect(readFold(storage, 'agent.task', true)).toBe(false)
    expect(readFold(storage, 'agent.reportRules', false)).toBe(true)
  })

  test('each section apart', () => {
    const storage = memoryStorage()
    writeFold(storage, 'agent.task', false)
    expect(readFold(storage, 'agent.activity', true)).toBe(true)
  })

  test('a value it did not write, or no storage at all: the default', () => {
    const storage = memoryStorage()
    storage.setItem(foldKey('agent.task'), 'yes')
    expect(readFold(storage, 'agent.task', true)).toBe(true)
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readFold(broken, 'agent.task', false)).toBe(false)
    expect(() => writeFold(broken, 'agent.task', true)).not.toThrow()
    expect(readFold(null, 'agent.task', true)).toBe(true)
  })
})
