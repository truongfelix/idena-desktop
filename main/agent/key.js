const fs = require('fs-extra')

// The hosted model's API key: encrypted by the system keychain (Electron safeStorage) and only the encrypted bytes
// written to the user data folder, so no file of the profile holds the key. The key never goes back to the
// renderer: the main process reads it for the provider's request alone.

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

  return {
    keychain: () => keychainState(safeStorage, platform),
    has: () => fs.existsSync(file()),
    set(key) {
      const value = typeof key === 'string' ? key.trim() : ''
      if (!value || value.length > MAX_KEY_LENGTH || /\s/u.test(value))
        throw new Error('invalid key')
      assertKeychain()
      fs.outputFileSync(file(), safeStorage.encryptString(value), {mode: 0o600})
    },
    /** The key, for the provider's request; null when none is kept. */
    read() {
      if (!fs.existsSync(file())) return null
      assertKeychain()
      return safeStorage.decryptString(fs.readFileSync(file()))
    },
    clear() {
      fs.removeSync(file())
    },
  }
}

module.exports = {createAgentKey, keychainState}
