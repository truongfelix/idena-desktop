const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgentKey, keychainState} = require('./key')

const ANTHROPIC = {provider: 'anthropic', address: 'https://api.anthropic.com'}

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
    expect(key.has(ANTHROPIC)).toBe(false)
    expect(key.read(ANTHROPIC)).toBeNull()
    key.set('  sk-test-1234567890  ', ANTHROPIC)
    expect(key.has(ANTHROPIC)).toBe(true)
    expect(key.read(ANTHROPIC)).toBe('sk-test-1234567890')
    const onDisk = fs.readFileSync(file).toString()
    expect(onDisk).not.toContain('sk-test-1234567890')
    if (process.platform !== 'win32')
      expect(fs.statSync(file).mode.toString(8).slice(-3)).toBe('600')
    key.clear()
    expect(key.has(ANTHROPIC)).toBe(false)
  })

  test('sent only to the provider and address it was saved for, never to a local server', () => {
    const key = createAgentKey({
      file: () => file,
      safeStorage: fakeSafeStorage(),
      platform: 'linux',
    })
    key.set('sk-ant-1', ANTHROPIC)
    expect(
      key.read({provider: 'local', address: 'http://127.0.0.1:11434/v1'})
    ).toBeNull()
    expect(
      key.read({provider: 'openai', address: ANTHROPIC.address})
    ).toBeNull()
    expect(key.read({...ANTHROPIC, address: 'https://other.test'})).toBeNull()
    expect(
      key.has({provider: 'openai', address: 'https://api.openai.com/v1'})
    ).toBe(false)
    expect(key.hasAny()).toBe(true)
    key.clear()
    expect(key.hasAny()).toBe(false)
    expect(() =>
      key.set('sk-1', {provider: 'local', address: 'http://127.0.0.1'})
    ).toThrow('hosted model only')
  })

  test('the binding is inside the encrypted bytes: no file to edit', () => {
    const key = createAgentKey({
      file: () => file,
      safeStorage: fakeSafeStorage(),
      platform: 'linux',
    })
    key.set('sk-ant-1', ANTHROPIC)
    expect(fs.readFileSync(file).toString()).not.toContain('anthropic.com')
    expect(fs.readdirSync(path.dirname(file))).toEqual(['key.enc'])
  })

  test('no keychain any more: no key, and a local model is not stopped by it', () => {
    let available = true
    const safeStorage = {
      ...fakeSafeStorage(),
      isEncryptionAvailable: () => available,
    }
    const key = createAgentKey({
      file: () => file,
      safeStorage,
      platform: 'linux',
    })
    key.set('sk-ant-1', ANTHROPIC)
    available = false
    expect(key.has(ANTHROPIC)).toBe(false)
    expect(
      key.read({provider: 'local', address: 'http://127.0.0.1:11434/v1'})
    ).toBeNull()
    expect(() => key.read(ANTHROPIC)).toThrow(/cannot be kept/u)
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
      expect(() => key.set('sk-test', ANTHROPIC)).toThrow(/cannot be kept/u)
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
    expect(() => key.set('', ANTHROPIC)).toThrow('invalid key')
    expect(() => key.set('sk one', ANTHROPIC)).toThrow('invalid key')
    expect(() => key.set(42, ANTHROPIC)).toThrow('invalid key')
  })

  describe('one key per service (B-243)', () => {
    const OPENAI = {provider: 'openai', address: 'https://api.openai.com/v1'}
    let single
    const store = () =>
      createAgentKey({
        file: () => file,
        singleFile: () => single,
        safeStorage: fakeSafeStorage(),
        platform: 'linux',
      })
    const writeSingle = (value) => {
      fs.outputFileSync(
        single,
        fakeSafeStorage().encryptString(JSON.stringify(value))
      )
    }
    beforeEach(() => {
      file = path.join(dir, 'agent', 'keys.enc')
      single = path.join(dir, 'agent', 'key.enc')
    })

    test('two services keep their own key; saving one again replaces only it', () => {
      const key = store()
      key.set('sk-ant-1', ANTHROPIC)
      key.set('sk-oa-1', OPENAI)
      key.set('sk-ant-2', ANTHROPIC)
      expect(key.read(ANTHROPIC)).toBe('sk-ant-2')
      expect(key.read(OPENAI)).toBe('sk-oa-1')
      const onDisk = fs.readFileSync(file).toString()
      expect(onDisk).not.toContain('sk-ant-2')
      expect(onDisk).not.toContain('sk-oa-1')
      key.clear(ANTHROPIC)
      expect(key.has(ANTHROPIC)).toBe(false)
      expect(key.read(OPENAI)).toBe('sk-oa-1')
      key.clear()
      expect(key.hasAny()).toBe(false)
      expect(fs.existsSync(file)).toBe(false)
    })

    test("the single agent's key is read, and left for an older build", () => {
      writeSingle({key: 'sk-ant-old', ...ANTHROPIC})
      const before = fs.readFileSync(single)
      const key = store()
      expect(key.read(ANTHROPIC)).toBe('sk-ant-old')
      key.set('sk-oa-1', OPENAI)
      expect(key.read(ANTHROPIC)).toBe('sk-ant-old')
      expect(key.read(OPENAI)).toBe('sk-oa-1')
      expect(fs.readFileSync(single)).toEqual(before)
    })

    test("removing the single agent's key removes its file too: it does not come back", () => {
      writeSingle({key: 'sk-ant-old', ...ANTHROPIC})
      const key = store()
      key.set('sk-oa-1', OPENAI)
      key.clear(OPENAI)
      expect(key.read(ANTHROPIC)).toBe('sk-ant-old')
      expect(fs.existsSync(single)).toBe(true)
      key.clear(ANTHROPIC)
      expect(fs.existsSync(single)).toBe(false)
      expect(key.hasAny()).toBe(false)
    })

    test("another service's removal keeps the single agent's key", () => {
      writeSingle({key: 'sk-ant-old', ...ANTHROPIC})
      const key = store()
      key.clear(OPENAI)
      expect(key.read(ANTHROPIC)).toBe('sk-ant-old')
    })
    test('a key the older build saved after the list wins for its service (new, old, new)', () => {
      const key = store()
      key.set('sk-ant-A', ANTHROPIC)
      key.set('sk-oa-1', OPENAI)
      writeSingle({key: 'sk-ant-B', ...ANTHROPIC})
      const later = Date.now() / 1000 + 60
      fs.utimesSync(single, later, later)
      expect(key.read(ANTHROPIC)).toBe('sk-ant-B')
      expect(key.read(OPENAI)).toBe('sk-oa-1')
    })

    test('a list the keychain cannot read is never written over', () => {
      const key = store()
      key.set('sk-oa-1', OPENAI)
      fs.writeFileSync(file, 'enc:garbage')
      const before = fs.readFileSync(file)
      expect(key.has(OPENAI)).toBe(false)
      expect(() => key.set('sk-ant-1', ANTHROPIC)).toThrow(/cannot be read/u)
      expect(() => key.clear(ANTHROPIC)).toThrow(/cannot be read/u)
      expect(fs.readFileSync(file)).toEqual(before)
      // Removing every key still works.
      key.clear()
      expect(fs.existsSync(file)).toBe(false)
    })
  })
})
