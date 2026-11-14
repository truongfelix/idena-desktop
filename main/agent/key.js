const fs = require('fs-extra')

// The hosted model's API key: encrypted by the system keychain (Electron safeStorage) and only the encrypted bytes
// written to the user data folder, so no file of the profile holds the key. The key never goes back to the
// renderer: the main process reads it for the provider's request alone. It is kept with the provider and the
// address it was saved for, inside the encrypted bytes: after a change of either, it is not sent (a key for one
// service never goes to another, nor to a server on this computer).

const MAX_KEY_LENGTH = 1024

/**
 * Linux backends that do not encrypt with a secret of the user's session: "basic_text" is a fixed password in
 * Chromium's code, so the bytes on disk would be as good as the key itself.
 */
const UNSAFE_BACKENDS = new Set(['basic_text', 'unknown'])

/** Whether this computer can keep a key: a keychain is there, and it is a real one. */
function keychainState(safeStorage, platform = process.platform) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable())
    return {available: false, reason: 'no keychain'}
  if (
    platform === 'linux' &&
    typeof safeStorage.getSelectedStorageBackend === 'function'
  ) {
    const backend = safeStorage.getSelectedStorageBackend()
    if (UNSAFE_BACKENDS.has(backend))
      return {available: false, reason: `no keychain (${backend})`}
  }
  return {available: true, reason: null}
}

const MAX_KEYS = 20

/**
 * The keys of the hosted services, one per provider and address, shared by the agents that use that service
 * (B-243). `file` holds them all, encrypted as one list; `singleFile` is the one key of the single agent (before
 * B-243), read while `file` does not exist yet and left for an older build, removed only with that key.
 */
function createAgentKey({
  file,
  singleFile = null,
  safeStorage,
  platform = process.platform,
}) {
  const assertKeychain = () => {
    const state = keychainState(safeStorage, platform)
    if (!state.available)
      throw new Error(
        `the key cannot be kept on this computer: ${state.reason}`
      )
  }

  const decrypt = (path) => {
    try {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(path)))
    } catch {
      return null
    }
  }
  const isEntry = (value) =>
    Boolean(value) &&
    typeof value.key === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.address === 'string'

  /** The single agent's key, {key, provider, address}, or null (none, or unreadable). */
  const single = () => {
    if (!singleFile || !fs.existsSync(singleFile())) return null
    assertKeychain()
    const value = decrypt(singleFile())
    return isEntry(value) ? value : null
  }

  const matches = (value, {provider, address} = {}) =>
    Boolean(value) && value.provider === provider && value.address === address

  const modified = (path) => fs.statSync(path).mtimeMs

  /**
   * What is kept: a list of {key, provider, address}. A list the keychain cannot read is empty to a reader, and
   * refused (`strict`) to a change, which would write over the keys it holds. The single agent's key saved after the
   * list (an older build run in between) replaces the list's key for its service.
   */
  const kept = ({strict = false} = {}) => {
    if (!fs.existsSync(file())) {
      const only = single()
      return only ? [only] : []
    }
    assertKeychain()
    const value = decrypt(file())
    if (!value || !Array.isArray(value.keys)) {
      if (strict)
        throw new Error(
          'the saved keys cannot be read: remove them all to start again'
        )
      return []
    }
    const keys = value.keys.filter(isEntry)
    const old =
      singleFile &&
      fs.existsSync(singleFile()) &&
      modified(singleFile()) > modified(file())
        ? single()
        : null
    return old ? [...keys.filter((entry) => !matches(entry, old)), old] : keys
  }

  const save = (keys) => {
    if (keys.length === 0) {
      fs.removeSync(file())
      return
    }
    fs.outputFileSync(
      file(),
      safeStorage.encryptString(JSON.stringify({keys})),
      {
        mode: 0o600,
      }
    )
  }

  return {
    keychain: () => keychainState(safeStorage, platform),
    /** Whether a key is kept for this provider and address. */
    has(destination) {
      if (!keychainState(safeStorage, platform).available) return false
      return kept().some((value) => matches(value, destination))
    },
    /** Whether a key is kept at all: one saved for another provider or address can still be removed. */
    hasAny() {
      if (!keychainState(safeStorage, platform).available) return false
      return kept().length > 0
    },
    /** Keeps the key of this provider and address, in place of the one it had; the others stay. */
    set(key, {provider, address} = {}) {
      const value = typeof key === 'string' ? key.trim() : ''
      if (!value || value.length > MAX_KEY_LENGTH || /\s/u.test(value))
        throw new Error('invalid key')
      if (provider === 'local' || !provider || !address)
        throw new Error('a key is kept for a hosted model only')
      assertKeychain()
      const others = kept({strict: true}).filter(
        (entry) => !matches(entry, {provider, address})
      )
      if (others.length >= MAX_KEYS) throw new Error('too many keys')
      save([...others, {key: value, provider, address}])
    },
    /** The key kept for this provider and address, for its request; null otherwise. */
    read(destination) {
      if (!destination || destination.provider === 'local') return null
      const value = kept().find((entry) => matches(entry, destination))
      return value ? value.key : null
    },
    /** Removes the key of this provider and address, or every key without one (or without a keychain). */
    clear(destination) {
      if (!destination || !keychainState(safeStorage, platform).available) {
        fs.removeSync(file())
        if (singleFile) fs.removeSync(singleFile())
        return
      }
      const keys = kept({strict: true}).filter(
        (entry) => !matches(entry, destination)
      )
      if (singleFile && fs.existsSync(singleFile())) {
        const old = single()
        if (!old || matches(old, destination)) fs.removeSync(singleFile())
      }
      save(keys)
    },
  }
}

module.exports = {createAgentKey, keychainState}
