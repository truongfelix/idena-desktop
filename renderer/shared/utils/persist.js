const persistentState = global.persistentState || {}

export function loadPersistentState(dbName) {
  try {
    const value = persistentState.getState(dbName)
    return Object.keys(value).length === 0 ? null : value || null
  } catch (error) {
    return null
  }
}

export function loadPersistentStateValue(dbName, key) {
  if ((key ?? null) === null) {
    throw new Error('loadItem requires key to be passed')
  }
  const state = loadPersistentState(dbName)
  return (state && state[key]) || null
}

export function persistItem(dbName, key, value) {
  try {
    persistentState.set(dbName, key, value)
  } catch {
    global.logger?.error?.(
      'error writing persistent item:',
      storageLogContext(dbName, key)
    )
  }
}

// The state with the saved values of `keys` instead of its own: other code writes those keys to the same file.
export function withSavedKeys(name, state, keys) {
  if (!keys || keys.length === 0) return state
  const saved = loadPersistentState(name) || {}
  const result = {...state}
  for (const key of keys) {
    if (key in saved) {
      result[key] = saved[key]
    } else {
      delete result[key]
    }
  }
  return result
}

export function persistState(name, state) {
  try {
    persistentState.setState(name, state)
  } catch {
    global.logger?.error?.(
      'error writing persistent state:',
      storageLogContext(name)
    )
  }
}

function storageLogContext(name, key) {
  return {
    name,
    ...(typeof key === 'undefined' ? {} : {key}),
  }
}

/**
 * Checks if action or action list has the name passed
 * @param {(string|string[])} actionList
 * @param {string} action
 */
export function shouldPersist(actionList, action) {
  if (!actionList || actionList.length === 0) {
    return true
  }
  const actionName = Array.isArray(action) ? action[0] : action.type
  return Array.isArray(actionList)
    ? actionList.includes(actionName)
    : actionList === actionName
}
