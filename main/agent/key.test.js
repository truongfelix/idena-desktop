const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgentKey, keychainState} = require('./key')

/** A keychain that "encrypts" by reversing and tagging, enough to see what lands on disk. */
function fakeSafeStorage({available = true, backend = 'gnome_libsecret'} = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from(`enc:${[...s].reverse().join('')}`),
    decryptString: (b) => [...b.toString().slice(4)].reverse().join(''),
  }
}

describe('agent key', () => {
  let dir
  let file
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-key-'))
    file = path.join(dir, 'agent', 'key.enc')
  })
  afterEach(() => fs.removeSync(dir))

  test('kept encrypted: no file holds the key', () => {
    const key = createAgentKey({
      file: () => file,
      safeStorage: fakeSafeStorage(),
      platform: 'linux',
    })
    expect(key.has()).toBe(false)
    expect(key.read()).toBeNull()
    key.set('  sk-test-1234567890  ')
    expect(key.has()).toBe(true)
    expect(key.read()).toBe('sk-test-1234567890')
    const onDisk = fs.readFileSync(file).toString()
    expect(onDisk).not.toContain('sk-test-1234567890')
    if (process.platform !== 'win32')
      expect(fs.statSync(file).mode.toString(8).slice(-3)).toBe('600')
    key.clear()
    expect(key.has()).toBe(false)
  })

  test('refused without a real keychain: nothing written', () => {
    const keyFile = file
    ;[
      fakeSafeStorage({available: false}),
      fakeSafeStorage({backend: 'basic_text'}),
    ].forEach((safeStorage) => {
      const key = createAgentKey({
        file: () => keyFile,
        safeStorage,
        platform: 'linux',
      })
      expect(() => key.set('sk-test')).toThrow(/cannot be kept/u)
      expect(fs.existsSync(keyFile)).toBe(false)
    })
  })

  test('the Linux backend check is for Linux only', () => {
    const safeStorage = fakeSafeStorage({backend: 'basic_text'})
    expect(keychainState(safeStorage, 'darwin').available).toBe(true)
    expect(keychainState(safeStorage, 'linux').available).toBe(false)
  })

  test('an empty or spaced key is refused', () => {
    const key = createAgentKey({
      file: () => file,
      safeStorage: fakeSafeStorage(),
      platform: 'linux',
    })
    expect(() => key.set('')).toThrow('invalid key')
    expect(() => key.set('sk one')).toThrow('invalid key')
    expect(() => key.set(42)).toThrow('invalid key')
  })
})
