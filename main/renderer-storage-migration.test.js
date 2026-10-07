const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const {pathToFileURL} = require('url')
const {RENDERER_ORIGIN, rendererRoot} = require('./renderer-protocol')
const {
  MAX_ATTEMPTS,
  MIGRATION_MARKER_FILE,
  MIGRATION_PAGE,
  SOURCE_STORAGE,
  decodeStorageValue,
  encodeStorageValue,
  exportRendererStorage,
  importRendererStorage,
  migrateRendererStorage,
} = require('./renderer-storage-migration')

// The page functions are injected as source text: run them from that text, in a context that has only the
// page's globals, so a reference to this module's scope fails here as it would in the page. The constructors
// are this test's own, so that values keep passing instanceof on both sides.
function evaluateInPage(source) {
  const context = vm.createContext({
    Array,
    ArrayBuffer,
    Blob,
    DOMException,
    DataView,
    Date,
    File,
    Float32Array,
    Float64Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Number,
    Object,
    Promise,
    String,
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    atob,
    btoa,
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
  })
  return vm.runInContext(source, context)
}

function fromSource(fn) {
  return evaluateInPage(`(${fn})`)
}

function runInPage(fn, ...args) {
  return fromSource(fn)(...args)
}

async function roundTrip(value) {
  const encoded = await runInPage(encodeStorageValue, value)
  return runInPage(decodeStorageValue, JSON.parse(JSON.stringify(encoded)))
}

const bytes = (length, seed) =>
  Uint8Array.from({length}, (_, i) => (i * 31 + seed) % 256)

describe('renderer storage values', () => {
  it('keeps an ad draft with its File images', async () => {
    const ad = {
      id: 'draft-1',
      title: 'Draft',
      status: 'draft',
      stake: '1000',
      media: new File([bytes(300000, 1)], 'media.jpg', {
        type: 'image/jpeg',
        lastModified: 1600000000000,
      }),
      thumb: new File([bytes(5000, 2)], 'thumb.png', {
        type: 'image/png',
        lastModified: 1600000000001,
      }),
    }

    const copy = await roundTrip(ad)

    expect(copy).toMatchObject({
      id: 'draft-1',
      title: 'Draft',
      status: 'draft',
      stake: '1000',
    })
    for (const field of ['media', 'thumb']) {
      expect(copy[field]).toBeInstanceOf(File)
      expect(copy[field].name).toBe(ad[field].name)
      expect(copy[field].type).toBe(ad[field].type)
      expect(copy[field].lastModified).toBe(ad[field].lastModified)
      expect(new Uint8Array(await copy[field].arrayBuffer())).toEqual(
        new Uint8Array(await ad[field].arrayBuffer())
      )
    }
  })

  it('keeps binary data, dates and values JSON cannot hold', async () => {
    const shared = new Float64Array([1.5, -2, 3.25, 4])
    const value = {
      thumb: bytes(900, 4),
      blob: new Blob([bytes(10, 5)], {type: 'application/octet-stream'}),
      buffer: bytes(16, 6).buffer,
      offsetView: shared.subarray(1, 3),
      date: new Date(1700000000000),
      numbers: [NaN, Infinity, -Infinity, 0, 1.5],
      list: [1, undefined, 'x', null, {deep: [true]}],
      missing: undefined,
    }

    const copy = await roundTrip(value)

    expect(copy.thumb).toBeInstanceOf(Uint8Array)
    expect(Array.from(copy.thumb)).toEqual(Array.from(value.thumb))
    expect(copy.blob).toBeInstanceOf(Blob)
    expect(copy.blob).not.toBeInstanceOf(File)
    expect(copy.blob.type).toBe('application/octet-stream')
    expect(new Uint8Array(await copy.blob.arrayBuffer())).toEqual(bytes(10, 5))
    expect(copy.buffer).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(copy.buffer))).toEqual(
      Array.from(bytes(16, 6))
    )
    expect(copy.offsetView).toBeInstanceOf(Float64Array)
    expect(Array.from(copy.offsetView)).toEqual([-2, 3.25])
    expect(copy.date).toBeInstanceOf(Date)
    expect(copy.date.getTime()).toBe(1700000000000)
    expect(copy.numbers).toEqual([NaN, Infinity, -Infinity, 0, 1.5])
    expect(copy.list).toEqual([1, undefined, 'x', null, {deep: [true]}])
    expect('missing' in copy).toBe(true)
    expect(copy.missing).toBeUndefined()
  })

  it('keeps primitive keys as they are', async () => {
    for (const key of ['official-draft-1', 7, '', 0]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await roundTrip(key)).toBe(key)
    }
  })

  describe('page functions run from their source', () => {
    let items

    beforeEach(() => {
      items = new Map([['connectIdenaBot', 'true']])
      global.localStorage = {
        get length() {
          return items.size
        },
        key: (i) => Array.from(items.keys())[i] ?? null,
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
      }
      global.indexedDB = {databases: async () => []}
    })

    afterEach(() => {
      delete global.localStorage
      delete global.indexedDB
    })

    it('exports localStorage', async () => {
      expect(
        await runInPage(exportRendererStorage, fromSource(encodeStorageValue))
      ).toEqual({databases: [], localStorage: {connectIdenaBot: 'true'}})
    })

    it('adds the keys that are not set and keeps the others', async () => {
      items.set('adListFilter', 'approved')

      const result = await runInPage(
        importRendererStorage,
        fromSource(decodeStorageValue),
        {
          databases: [],
          localStorage: {
            adListFilter: 'draft',
            connectIdenaBot: 'true',
            x: '1',
          },
        }
      )

      expect(result).toMatchObject({localStorageAdded: 1, localStorageKept: 2})
      expect(Object.fromEntries(items)).toEqual({
        connectIdenaBot: 'true',
        adListFilter: 'approved',
        x: '1',
      })
    })
  })
})

describe('renderer storage migration', () => {
  const appPath = path.resolve('test-app')
  const sourceUrl = pathToFileURL(
    path.join(rendererRoot(appPath), MIGRATION_PAGE)
  ).href
  const targetUrl = `${RENDERER_ORIGIN}/${MIGRATION_PAGE}`
  const exported = {
    databases: [
      {
        name: 'IdenaStore',
        version: 80,
        stores: [
          {
            name: 'ads',
            keyPath: 'id',
            autoIncrement: false,
            indexes: [],
            records: [{key: 'draft-1', value: {id: 'draft-1'}}],
          },
        ],
      },
    ],
    localStorage: {adListFilter: 'draft'},
  }
  const report = {
    added: 1,
    kept: 0,
    failed: 0,
    missingStores: 0,
    localStorageAdded: 1,
    localStorageKept: 0,
  }

  let userDataPath
  let copyPath
  let logger
  let windows
  let sourceSession

  // The official app's folders, one file each.
  function writeOfficialStorage(folders = SOURCE_STORAGE) {
    for (const folder of folders) {
      fs.mkdirSync(path.join(userDataPath, folder), {recursive: true})
      fs.writeFileSync(path.join(userDataPath, folder, 'CURRENT'), folder)
    }
  }

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-storage-'))
    copyPath = path.join(
      userDataPath,
      'Partitions',
      'renderer-storage-migration'
    )
    logger = {info: jest.fn(), error: jest.fn()}
    windows = []
    sourceSession = {
      storagePath: copyPath,
      clearStorageData: jest.fn(async () => {}),
    }
  })

  afterEach(() => {
    fs.rmSync(userDataPath, {force: true, recursive: true})
  })

  // A hidden window whose pages answer like the real ones; `steps` changes what one step does.
  function hiddenWindows({source = exported, steps = {}} = {}) {
    return jest.fn((windowSession) => {
      const window = {
        session: windowSession,
        urls: [],
        scripts: [],
        destroyed: false,
        loadURL: jest.fn(async (url) => {
          window.urls.push(url)
          if (steps.load) await steps.load()
        }),
        webContents: {
          executeJavaScript: jest.fn(async (script) => {
            window.scripts.push(script)
            const step = script.includes(
              'async function exportRendererStorage('
            )
              ? 'export'
              : 'import'
            if (steps[step]) await steps[step]()
            return {value: step === 'export' ? source : report}
          }),
        },
        isDestroyed: () => window.destroyed,
        destroy: jest.fn(() => {
          window.destroyed = true
        }),
      }
      windows.push(window)
      return window
    })
  }

  const run = (options = {}) =>
    migrateRendererStorage({
      appPath,
      userDataPath,
      createWindow: hiddenWindows(),
      getSourceSession: jest.fn(() => sourceSession),
      fs,
      logger,
      ...options,
    })

  const marker = () =>
    JSON.parse(
      fs.readFileSync(path.join(userDataPath, MIGRATION_MARKER_FILE), 'utf8')
    )

  const fail = (message) => () => Promise.reject(new Error(message))
  const hang = () => new Promise(() => {})
  const sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    })

  it('reads a copy of the official files, adds them to the app origin, then stops for good', async () => {
    writeOfficialStorage()
    const copied = []
    const createWindow = hiddenWindows({
      steps: {
        export: async () => {
          for (const folder of SOURCE_STORAGE) {
            copied.push(
              fs.readFileSync(path.join(copyPath, folder, 'CURRENT'), 'utf8')
            )
          }
        },
      },
    })

    const getSourceSession = jest.fn(() => {
      // The copy is there before the session opens its databases.
      expect(fs.existsSync(path.join(copyPath, SOURCE_STORAGE[2]))).toBe(true)
      return sourceSession
    })

    const result = await run({createWindow, getSourceSession})

    expect(getSourceSession).toHaveBeenCalledTimes(1)
    expect(copied).toEqual(SOURCE_STORAGE)
    expect(windows).toHaveLength(2)
    const [source, target] = windows
    expect(source.session).toBe(sourceSession)
    expect(source.urls).toEqual([sourceUrl])
    expect(source.scripts[0]).toContain(
      '{value: await (async function exportRendererStorage(encodeValue) {'
    )
    expect(source.scripts[0]).toContain(
      ')(async function encodeStorageValue(value) {'
    )
    expect(target.session).toBeUndefined()
    expect(target.urls).toEqual([targetUrl])
    expect(target.scripts[0]).toContain(
      '(async function importRendererStorage('
    )
    expect(target.scripts[0]).toContain('function decodeStorageValue(value) {')
    expect(target.scripts[0]).toContain(`, ${JSON.stringify(exported)})}`)
    expect(result).toEqual({status: 'done', found: true, ...report})
    expect(marker()).toEqual({...result, attempts: 1})

    expect(source.destroy).toHaveBeenCalledTimes(1)
    expect(target.destroy).toHaveBeenCalledTimes(1)
    expect(sourceSession.clearStorageData).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(copyPath)).toBe(false)
    for (const folder of SOURCE_STORAGE) {
      expect(
        fs.readFileSync(path.join(userDataPath, folder, 'CURRENT'), 'utf8')
      ).toBe(folder)
    }

    const again = hiddenWindows()
    const noSession = jest.fn()
    expect(
      await run({createWindow: again, getSourceSession: noSession})
    ).toEqual({status: 'skipped'})
    expect(again).not.toHaveBeenCalled()
    expect(noSession).not.toHaveBeenCalled()
  })

  it('opens no window when the official app left no folders', async () => {
    const createWindow = hiddenWindows()
    const getSourceSession = jest.fn()

    const result = await run({createWindow, getSourceSession})

    expect(result).toEqual({status: 'done', found: false})
    expect(marker()).toEqual({status: 'done', found: false, attempts: 1})
    expect(createWindow).not.toHaveBeenCalled()
    expect(getSourceSession).not.toHaveBeenCalled()
  })

  it('does not open the app origin when the copy holds nothing', async () => {
    writeOfficialStorage([SOURCE_STORAGE[2]])
    const createWindow = hiddenWindows({
      source: {
        databases: [
          {
            name: 'IdenaStore',
            version: 80,
            stores: [{...exported.databases[0].stores[0], records: []}],
          },
        ],
        localStorage: {},
      },
    })

    const result = await run({createWindow})

    expect(windows).toHaveLength(1)
    expect(windows[0].urls).toEqual([sourceUrl])
    expect(result).toEqual({status: 'done', found: false})
    expect(marker()).toEqual({status: 'done', found: false, attempts: 1})
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(copyPath)).toBe(false)
  })

  it('moves localStorage alone', async () => {
    writeOfficialStorage([SOURCE_STORAGE[2]])
    const createWindow = hiddenWindows({
      source: {databases: [], localStorage: {a: '1'}},
    })

    expect((await run({createWindow})).found).toBe(true)
    expect(windows.map(({urls}) => urls)).toEqual([[sourceUrl], [targetUrl]])
  })

  it.each(['load', 'export', 'import'])(
    'retries after a failure to %s, three attempts in all',
    async (step) => {
      writeOfficialStorage()
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        windows = []
        const createWindow = hiddenWindows({
          steps: {[step]: fail(`${step} failed`)},
        })
        // eslint-disable-next-line no-await-in-loop
        const result = await run({createWindow})
        expect(result).toEqual({
          status: 'failed',
          error: `${step === 'import' ? 'import' : 'export'}: ${step} failed`,
        })
        expect(marker()).toMatchObject({status: 'failed', attempts: attempt})
        expect(windows.every((window) => window.destroyed)).toBe(true)
        expect(fs.existsSync(copyPath)).toBe(false)
      }
      expect(logger.error).toHaveBeenCalledTimes(MAX_ATTEMPTS)

      const last = hiddenWindows()
      expect(await run({createWindow: last})).toEqual({status: 'skipped'})
      expect(last).not.toHaveBeenCalled()
    }
  )

  it('succeeds at a later start after a failure', async () => {
    writeOfficialStorage()
    await run({
      createWindow: hiddenWindows({steps: {import: fail('import failed')}}),
    })

    const result = await run()

    expect(result.status).toBe('done')
    expect(marker()).toMatchObject({status: 'done', attempts: 2})
  })

  it.each(['export', 'import'])(
    'gives up on a page that never answers (%s) and closes it',
    async (step) => {
      writeOfficialStorage()
      const createWindow = hiddenWindows({steps: {[step]: hang}})

      const result = await run({createWindow, timeoutMs: 20})

      expect(result).toEqual({status: 'failed', error: 'timed out after 20 ms'})
      expect(marker()).toMatchObject({status: 'failed', attempts: 1})
      expect(windows.every((window) => window.destroyed)).toBe(true)
      expect(sourceSession.clearStorageData).toHaveBeenCalledTimes(1)
      expect(fs.existsSync(copyPath)).toBe(false)
    }
  )

  it('opens no window after it gave up', async () => {
    writeOfficialStorage()
    const createWindow = hiddenWindows({
      steps: {export: () => sleep(60)},
    })

    expect((await run({createWindow, timeoutMs: 20})).status).toBe('failed')
    await sleep(120)

    expect(createWindow).toHaveBeenCalledTimes(1)
  })

  it('reports an exception of the page with its message', async () => {
    writeOfficialStorage()
    global.indexedDB = {
      databases: async () => {
        throw new DOMException(
          'The transaction has finished.',
          'InvalidStateError'
        )
      },
    }
    const createWindow = hiddenWindows()

    try {
      const result = await run({
        createWindow: (windowSession) => {
          const window = createWindow(windowSession)
          window.webContents.executeJavaScript = evaluateInPage
          return window
        },
      })

      expect(result).toEqual({
        status: 'failed',
        error: 'export: InvalidStateError: The transaction has finished.',
      })
    } finally {
      delete global.indexedDB
    }
  })

  it('stops when the copy session keeps its files elsewhere', async () => {
    writeOfficialStorage()
    sourceSession.storagePath = path.join(userDataPath, 'Partitions', 'other')
    const createWindow = hiddenWindows()

    const result = await run({createWindow})

    expect(result).toEqual({
      status: 'failed',
      error: `export: the copy session keeps its files in ${sourceSession.storagePath}`,
    })
    expect(createWindow).not.toHaveBeenCalled()
    expect(fs.existsSync(copyPath)).toBe(false)
  })

  it('does not throw when a window cannot be created', async () => {
    writeOfficialStorage()
    const result = await run({
      createWindow: () => {
        throw new Error('no display')
      },
    })

    expect(result).toEqual({status: 'failed', error: 'no display'})
    expect(marker()).toMatchObject({status: 'failed', attempts: 1})
    expect(fs.existsSync(copyPath)).toBe(false)
  })

  it('finishes when the copy session cannot be cleared', async () => {
    writeOfficialStorage()
    sourceSession.clearStorageData.mockRejectedValue(new Error('busy'))

    expect((await run()).status).toBe('done')
    expect(logger.error).toHaveBeenCalledWith(
      'cannot clear the renderer storage migration session',
      {error: 'busy'}
    )
    expect(fs.existsSync(copyPath)).toBe(false)
  })

  it('deletes a copy left by an earlier start', async () => {
    writeOfficialStorage()
    await run()
    fs.mkdirSync(path.join(copyPath, 'Cache'), {recursive: true})

    expect(await run()).toEqual({status: 'skipped'})
    expect(fs.existsSync(copyPath)).toBe(false)
  })

  it('treats an unreadable marker as no marker', async () => {
    writeOfficialStorage()
    fs.writeFileSync(path.join(userDataPath, MIGRATION_MARKER_FILE), '{oops')

    expect((await run()).status).toBe('done')
  })

  it('still finishes when the marker cannot be written', async () => {
    writeOfficialStorage()
    const readOnlyFs = {
      ...fs,
      writeFileSync: () => {
        throw new Error('EACCES')
      },
    }

    const result = await run({fs: readOnlyFs})

    expect(result.status).toBe('done')
    expect(logger.error).toHaveBeenCalledWith(
      'cannot write the renderer storage migration marker',
      expect.any(Error)
    )
    expect(windows.every((window) => window.destroyed)).toBe(true)
  })
})
