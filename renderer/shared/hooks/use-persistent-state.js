import {useState, useEffect, useRef} from 'react'
import {
  loadPersistentStateValue,
  persistItem,
  persistState,
  shouldPersist,
  withSavedKeys,
} from '../utils/persist'

export function usePersistentState(dbName, key, initialValue) {
  const [value, setValue] = useState(
    () => loadPersistentStateValue(dbName, key) || initialValue
  )

  useEffect(() => {
    // if we have something to write
    if (value) {
      persistItem(dbName, key, value)
    }
  }, [dbName, key, value])

  return [value, setValue]
}

/**
 * Middleware-style hook persisting reducer state
 *
 * @param {*} useReducer Original useReducer
 * @param {string} name Name of the file to be persisted in
 * @param {(string|string[])} [on] If passed whitelists actions triggering persistence
 * @param {string[]} [savedElsewhere] Keys other code writes to the same file: their saved values are written
 */
export function usePersistence([state, dispatch], name, on, savedElsewhere) {
  const actionRef = useRef()

  const newDispatchRef = useRef((action) => {
    actionRef.current = action
    dispatch(action)
  })

  useEffect(() => {
    const action = actionRef.current
    if (action && shouldPersist(on, action)) {
      persistState(name, withSavedKeys(name, state, savedElsewhere))
    }
    // TODO: Do we have something to do with the cleanup? 🤔
  }, [name, on, savedElsewhere, state])

  return [state, newDispatchRef.current]
}
