const fs = require('fs')
const path = require('path')
const {createPersistentStateBridge} = require('./safe-store-bridge')

// Every store name the renderer passes to the persist helpers, read from its sources.
function rendererStoreNames() {
  const names = new Set()
  const call =
    /\b(?:loadPersistentState|loadPersistentStateValue|persistItem|persistState|usePersistentState)\(\s*'([^']+)'/gu
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['.next', 'out', 'node_modules'].includes(entry.name)) visit(file)
      } else if (
        entry.name.endsWith('.js') &&
        !entry.name.endsWith('.test.js')
      ) {
        for (const [, name] of fs.readFileSync(file, 'utf8').matchAll(call)) {
          names.add(name)
        }
      }
    }
  }
  visit(path.join(__dirname, '..', 'renderer'))
  return [...names].sort()
}

describe('persistent state context bridge', () => {
  it('allows scoped state operations', () => {
    const write = jest.fn(() => ({saved: true}))
    const db = {
      getState: jest.fn(() => ({locale: 'en'})),
      set: jest.fn(() => ({write})),
      setState: jest.fn(() => ({write})),
    }
    const prepareDb = jest.fn(() => db)
    const bridge = createPersistentStateBridge(prepareDb)

    expect(bridge.getState('settings')).toEqual({locale: 'en'})
    expect(bridge.set('settings', 'locale', 'de')).toEqual({saved: true})
    expect(bridge.setState('settings', {locale: 'fr'})).toEqual({saved: true})
    expect(prepareDb).toHaveBeenCalledWith('settings')
  })

  it('allows every store the renderer uses', () => {
    const names = rendererStoreNames()
    expect(names).toEqual(
      expect.arrayContaining(['settings', 'validation2', 'flipArchive'])
    )
    const write = jest.fn(() => ({saved: true}))
    const db = {
      getState: jest.fn(() => ({})),
      set: jest.fn(() => ({write})),
      setState: jest.fn(() => ({write})),
    }
    const bridge = createPersistentStateBridge(jest.fn(() => db))
    for (const name of names) {
      expect(() => bridge.getState(name)).not.toThrow()
      expect(bridge.setState(name, {})).toEqual({saved: true})
    }
  })

  it('rejects traversal names and unsafe keys', () => {
    const bridge = createPersistentStateBridge(jest.fn())

    expect(() => bridge.getState('../settings')).toThrow(
      'Invalid persistent store name'
    )
    expect(() => bridge.set('settings', '../apiKey', 'value')).toThrow(
      'Invalid persistent store key'
    )
    expect(() => bridge.getState('other')).toThrow(
      'Unsupported persistent store name'
    )
  })
})
