// The flip archive mark through the real store bridge (main/safe-store-bridge.js) over an in-memory store.
const {createPersistentStateBridge} = require('../../../main/safe-store-bridge')

function memoryDb() {
  const stores = {}
  return (name) => {
    stores[name] = stores[name] || {}
    const db = {
      getState: () => stores[name],
      set: (key, value) => ({
        write: () => {
          stores[name][key] = value
        },
      }),
      setState: (value) => ({
        write: () => {
          stores[name] = value
        },
      }),
    }
    return db
  }
}

function loadFlipUtils() {
  jest.resetModules()
  global.logger = {error: jest.fn()}
  global.persistentState = createPersistentStateBridge(memoryDb())
  // eslint-disable-next-line global-require
  return require('./utils')
}

describe('flip archive mark', () => {
  it('is kept for the epoch, so flips are archived once', () => {
    const {markFlipsArchived, didArchiveFlips} = loadFlipUtils()
    expect(didArchiveFlips(229)).toBe(false)
    markFlipsArchived(229)
    expect(global.logger.error).not.toHaveBeenCalled()
    expect(didArchiveFlips(229)).toBe(true)
    expect(didArchiveFlips(230)).toBe(false)
  })
})
