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

function createAgentKey({file, safeStorage, platform = process.platform}) {
  const assertKeychain = () => {
    const state = keychainState(safeStorage, platform)
    if (!state.available)
      throw new Error(
        `the key cannot be kept on this computer: ${state.reason}`
      )
  }

  /** What is kept: {key, provider, address}, or null (none, or unreadable). */
  const kept = () => {
    if (!fs.existsSync(file())) return null
    assertKeychain()
    try {
      const value = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(file()))
      )
      return value && typeof value.key === 'string' ? value : null
    } catch {
      return null
    }
  }
  const matches = (value, {provider, address} = {}) =>
    Boolean(value) && value.provider === provider && value.address === address

  return {
    keychain: () => keychainState(safeStorage, platform),
    /** Whether a key is kept for this provider and address. */
    has(destination) {
      if (!keychainState(safeStorage, platform).available) return false
      return matches(kept(), destination)
    },
    /** Whether a key is kept at all: one saved for another provider or address can still be removed. */
    hasAny() {
      if (!keychainState(safeStorage, platform).available) return false
      return Boolean(kept())
    },
    set(key, {provider, address} = {}) {
      const value = typeof key === 'string' ? key.trim() : ''
      if (!value || value.length > MAX_KEY_LENGTH || /\s/u.test(value))
        throw new Error('invalid key')
      if (provider === 'local' || !provider || !address)
        throw new Error('a key is kept for a hosted model only')
      assertKeychain()
      fs.outputFileSync(
        file(),
        safeStorage.encryptString(
          JSON.stringify({key: value, provider, address})
        ),
        {mode: 0o600}
      )
    },
    /** The key kept for this provider and address, for its request; null otherwise. */
    read(destination) {
      if (!destination || destination.provider === 'local') return null
      const value = kept()
      return matches(value, destination) ? value.key : null
    },
    clear() {
      fs.removeSync(file())
    },
  }
}

module.exports = {createAgentKey, keychainState}
