const SECRET_API_VALUE = ['secret-api', 'value-that-should-not-be-logged'].join(
  '-'
)
const SECRET_STATE_VALUE = [
  'encrypted-state',
  'value-that-should-not-be-logged',
].join('-')

function loadPersistModuleWithFailingDb() {
  jest.resetModules()

  global.logger = {
    error: jest.fn(),
  }
  global.persistentState = {
    getState: jest.fn(),
    set: jest.fn(() => {
      throw new Error('write failed')
    }),
    setState: jest.fn(() => {
      throw new Error('write failed')
    }),
  }

  // eslint-disable-next-line global-require
  return require('./persist')
}

describe('persistent storage logging', () => {
  afterEach(() => {
    delete global.logger
    delete global.persistentState
    jest.resetModules()
  })

  it('does not log item values when a write fails', () => {
    const {persistItem} = loadPersistModuleWithFailingDb()

    persistItem('settings', 'apiKey', SECRET_API_VALUE)

    const logged = JSON.stringify(global.logger.error.mock.calls)

    expect(logged).toContain('settings')
    expect(logged).toContain('apiKey')
    expect(logged).not.toContain(SECRET_API_VALUE)
  })

  it('does not log full state when a state write fails', () => {
    const {persistState} = loadPersistModuleWithFailingDb()

    persistState('settings', {
      apiKey: SECRET_API_VALUE,
      encryptedKey: SECRET_STATE_VALUE,
    })

    const logged = JSON.stringify(global.logger.error.mock.calls)

    expect(logged).toContain('settings')
    expect(logged).not.toContain(SECRET_API_VALUE)
    expect(logged).not.toContain(SECRET_STATE_VALUE)
  })
})

describe('keys other code writes to the same file', () => {
  function loadPersistModuleWithSaved(saved) {
    jest.resetModules()
    global.persistentState = {getState: jest.fn(() => saved)}
    // eslint-disable-next-line global-require
    return require('./persist')
  }

  afterEach(() => {
    delete global.persistentState
    jest.resetModules()
  })

  it('writes the saved value instead of the state one', () => {
    const {withSavedKeys} = loadPersistModuleWithSaved({
      lng: 'en',
      zoomLevel: 1.5,
    })

    expect(
      withSavedKeys('settings', {lng: 'fr', zoomLevel: 0}, ['zoomLevel'])
    ).toEqual({lng: 'fr', zoomLevel: 1.5})
    expect(global.persistentState.getState).toHaveBeenCalledWith('settings')
  })

  it('adds a saved value the state does not have', () => {
    const {withSavedKeys} = loadPersistModuleWithSaved({zoomLevel: -2})

    expect(withSavedKeys('settings', {lng: 'fr'}, ['zoomLevel'])).toEqual({
      lng: 'fr',
      zoomLevel: -2,
    })
  })

  it('leaves out a key that is not saved', () => {
    const {withSavedKeys} = loadPersistModuleWithSaved({})

    expect(
      withSavedKeys('settings', {lng: 'fr', zoomLevel: 3}, ['zoomLevel'])
    ).toEqual({lng: 'fr'})
  })

  it('writes the state as it is without such keys', () => {
    const {withSavedKeys} = loadPersistModuleWithSaved({zoomLevel: 1})
    const state = {lng: 'fr', zoomLevel: 0}

    expect(withSavedKeys('settings', state)).toBe(state)
    expect(withSavedKeys('settings', state, [])).toBe(state)
    expect(global.persistentState.getState).not.toHaveBeenCalled()
  })
})
