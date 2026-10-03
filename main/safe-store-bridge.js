const SAFE_STORE_NAME = /^[A-Za-z0-9_-]{1,64}$/u
const SAFE_STORE_KEY = /^[A-Za-z0-9._-]{1,128}$/u
// The stores the renderer keeps its state in (renderer/shared/utils/persist.js), one JSON file each in the
// user data directory. A name missing here makes every write to that store fail silently: validation2
// holds the validation in progress, so a restart or a page change would lose it.
const ALLOWED_STORE_NAMES = new Set([
  'settings',
  'validation2',
  'validationResults',
  'validationNotification',
  'flipArchive',
  'flipFilter',
])

function assertSafeName(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function createPersistentStateBridge(prepareDb) {
  const open = (name) => {
    const safeName = assertSafeName(
      name,
      SAFE_STORE_NAME,
      'persistent store name'
    )
    if (!ALLOWED_STORE_NAMES.has(safeName)) {
      throw new Error('Unsupported persistent store name')
    }
    return prepareDb(safeName)
  }

  return Object.freeze({
    getState(name) {
      return open(name).getState()
    },
    set(name, key, value) {
      const safeKey = assertSafeName(
        key,
        SAFE_STORE_KEY,
        'persistent store key'
      )
      return open(name).set(safeKey, value).write()
    },
    setState(name, value) {
      return open(name).setState(value).write()
    },
  })
}

module.exports = {
  createPersistentStateBridge,
}
