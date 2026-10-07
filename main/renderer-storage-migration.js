const path = require('path')
const {pathToFileURL} = require('url')
const {RENDERER_ORIGIN, rendererRoot} = require('./renderer-protocol')

// The official app loaded its pages from file:// (loadFile); this app serves them from idena-app://renderer.
// Chromium keeps IndexedDB and localStorage per origin, so the official app's ad drafts and ad voting cache
// (IndexedDB "IdenaStore") and its two localStorage keys stay behind under file://. At the first start, hidden
// windows read them on a blank page of each origin and add them to idena-app://renderer: records and keys
// that already exist there are kept. The settings and the other stores live in files of the userData folder,
// not in the renderer.
//
// The official app's files are read from a copy in a session of their own, deleted afterwards: once this
// Chromium opens an IndexedDB folder, the official app's older Chromium can no longer read it and drops it.
// Left as they are, the official app keeps its drafts if the user goes back to it.
const MIGRATION_PAGE = 'storage-migration.html'
const MIGRATION_MARKER_FILE = 'renderer-storage-migration.json'
const SOURCE_PARTITION_NAME = 'renderer-storage-migration'
const SOURCE_PARTITION = `persist:${SOURCE_PARTITION_NAME}`
// What the official app's pages left in the default session, relative to userData.
const SOURCE_STORAGE = [
  path.join('IndexedDB', 'file__0.indexeddb.leveldb'),
  path.join('IndexedDB', 'file__0.indexeddb.blob'),
  path.join('Local Storage', 'leveldb'),
]
const MAX_ATTEMPTS = 3
const MIGRATION_TIMEOUT_MS = 30 * 1000
const CLEAR_TIMEOUT_MS = 5 * 1000

// Runs in the page. Turns what IndexedDB holds and JSON cannot (Blob, File, binary data, Date, NaN,
// Infinity, undefined) into tagged plain objects. Self-contained: it is injected as source text.
async function encodeStorageValue(value) {
  const tag = '__idenaStorageValue'
  const toBase64 = (bytes) => {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  }

  if (value === undefined) return {[tag]: 'undefined'}
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return {[tag]: 'number', value: String(value)}
  }
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return {[tag]: 'date', time: value.getTime()}
  if (value instanceof Blob) {
    const blob = {
      [tag]: 'blob',
      type: value.type,
      base64: toBase64(new Uint8Array(await value.arrayBuffer())),
    }
    if (typeof File !== 'undefined' && value instanceof File) {
      blob.name = value.name
      blob.lastModified = value.lastModified
    }
    return blob
  }
  if (value instanceof ArrayBuffer) {
    return {
      [tag]: 'bytes',
      view: 'ArrayBuffer',
      base64: toBase64(new Uint8Array(value)),
    }
  }
  if (ArrayBuffer.isView(value)) {
    return {
      [tag]: 'bytes',
      view: value.constructor.name,
      base64: toBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      ),
    }
  }
  if (Array.isArray(value)) {
    const items = []
    for (const item of value) items.push(await encodeStorageValue(item))
    return items
  }
  const encoded = {}
  for (const [key, item] of Object.entries(value)) {
    encoded[key] = await encodeStorageValue(item)
  }
  return encoded
}

// Runs in the page: the reverse of encodeStorageValue. Self-contained.
function decodeStorageValue(value) {
  const tag = '__idenaStorageValue'
  const fromBase64 = (base64) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decodeStorageValue)
  switch (value[tag]) {
    case 'undefined':
      return undefined
    case 'number':
      return Number(value.value)
    case 'date':
      return new Date(value.time)
    case 'blob': {
      const bytes = fromBase64(value.base64)
      return typeof value.name === 'string'
        ? new File([bytes], value.name, {
            type: value.type,
            lastModified: value.lastModified,
          })
        : new Blob([bytes], {type: value.type})
    }
    case 'bytes': {
      const bytes = fromBase64(value.base64)
      if (value.view === 'ArrayBuffer') return bytes.buffer
      if (value.view === 'DataView') return new DataView(bytes.buffer)
      const View = {
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
      }[value.view]
      return View && bytes.byteLength % View.BYTES_PER_ELEMENT === 0
        ? new View(bytes.buffer)
        : bytes
    }
    default: {
      const decoded = {}
      for (const [key, item] of Object.entries(value)) {
        decoded[key] = decodeStorageValue(item)
      }
      return decoded
    }
  }
}

// Runs in the page of the old origin: every IndexedDB database with its schema and records, and
// localStorage. Self-contained but for the encoder it is given.
async function exportRendererStorage(encodeValue) {
  const request = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

  const databases = []
  for (const {name} of await indexedDB.databases()) {
    const db = await request(indexedDB.open(name))
    try {
      const stores = []
      for (const storeName of Array.from(db.objectStoreNames)) {
        const store = db
          .transaction(storeName, 'readonly')
          .objectStore(storeName)
        // Read before the first await: the transaction ends once its requests are done.
        const schema = {
          name: storeName,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes: Array.from(store.indexNames, (indexName) => {
            const index = store.index(indexName)
            return {
              name: indexName,
              keyPath: index.keyPath,
              unique: index.unique,
              multiEntry: index.multiEntry,
            }
          }),
        }
        const [keys, values] = await Promise.all([
          request(store.getAllKeys()),
          request(store.getAll()),
        ])
        const records = []
        for (let i = 0; i < values.length; i += 1) {
          records.push({
            key: await encodeValue(keys[i]),
            value: await encodeValue(values[i]),
          })
        }
        stores.push({...schema, records})
      }
      databases.push({name, version: db.version, stores})
    } finally {
      db.close()
    }
  }

  const localStorageItems = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    localStorageItems[key] = localStorage.getItem(key)
  }

  return {databases, localStorage: localStorageItems}
}

// Runs in the page of the new origin. Adds what exportRendererStorage found: a database that does not exist
// yet is created with the old schema and version; in one that exists, only the stores it has get records.
// A record whose key exists, or a localStorage key that is set, keeps the new origin's value. One record that
// cannot be added does not stop the others. Self-contained but for the decoder it is given.
async function importRendererStorage(decodeValue, exported) {
  const request = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const report = {
    added: 0,
    kept: 0,
    failed: 0,
    missingStores: 0,
    localStorageAdded: 0,
    localStorageKept: 0,
  }

  const existing = new Set((await indexedDB.databases()).map(({name}) => name))
  for (const source of exported.databases) {
    const openRequest = existing.has(source.name)
      ? indexedDB.open(source.name)
      : indexedDB.open(source.name, source.version)
    openRequest.onupgradeneeded = () => {
      const created = openRequest.result
      source.stores
        .filter(({name}) => !created.objectStoreNames.contains(name))
        .forEach((storeInfo) => {
          const store = created.createObjectStore(storeInfo.name, {
            keyPath: storeInfo.keyPath,
            autoIncrement: storeInfo.autoIncrement,
          })
          for (const index of storeInfo.indexes) {
            store.createIndex(index.name, index.keyPath, {
              unique: index.unique,
              multiEntry: index.multiEntry,
            })
          }
        })
    }
    const db = await request(openRequest)
    try {
      const stores = source.stores.filter(({records}) => records.length > 0)
      report.missingStores += stores.filter(
        ({name}) => !db.objectStoreNames.contains(name)
      ).length
      for (const storeInfo of stores.filter(({name}) =>
        db.objectStoreNames.contains(name)
      )) {
        const records = storeInfo.records.map(({key, value}) => ({
          key: decodeValue(key),
          value: decodeValue(value),
        }))
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeInfo.name, 'readwrite')
          const store = tx.objectStore(storeInfo.name)
          for (const {key, value} of records) {
            try {
              const add =
                store.keyPath === null
                  ? store.add(value, key)
                  : store.add(value)
              add.onsuccess = () => {
                report.added += 1
              }
              add.onerror = (event) => {
                // Handled here, the error neither aborts the transaction nor reaches tx.onerror.
                event.preventDefault()
                event.stopPropagation()
                if (add.error && add.error.name === 'ConstraintError') {
                  report.kept += 1
                } else {
                  report.failed += 1
                }
              }
            } catch {
              report.failed += 1
            }
          }
          tx.oncomplete = () => resolve()
          tx.onabort = () =>
            reject(tx.error || new Error('transaction aborted'))
        })
      }
    } finally {
      db.close()
    }
  }

  for (const [key, value] of Object.entries(exported.localStorage)) {
    if (localStorage.getItem(key) !== null) {
      report.localStorageKept += 1
    } else {
      try {
        localStorage.setItem(key, value)
        report.localStorageAdded += 1
      } catch {
        report.failed += 1
      }
    }
  }

  return report
}

// The page answers {value} or {error}: an exception thrown out of executeJavaScript loses its message.
function pageScript(fn, ...args) {
  return `(async () => {
  try {
    return {value: await (${fn})(${args.join(', ')})}
  } catch (error) {
    return {error: String(error)}
  }
})()`
}

async function runInPage(window, step, script) {
  let answer
  try {
    answer = await window.webContents.executeJavaScript(script)
  } catch (error) {
    throw new Error(`${step}: ${describeError(error)}`)
  }
  if (!answer || 'error' in answer) {
    throw new Error(`${step}: ${answer ? answer.error : 'no answer'}`)
  }
  return answer.value
}

async function loadPage(window, step, url) {
  try {
    await window.loadURL(url)
  } catch (error) {
    throw new Error(`${step}: ${describeError(error)}`)
  }
}

function describeError(error) {
  if (error && typeof error.message === 'string' && error.message) {
    return error.message
  }
  try {
    return JSON.stringify(error) || String(error)
  } catch {
    return String(error)
  }
}

function hasStorage(exported) {
  return (
    Object.keys(exported.localStorage).length > 0 ||
    exported.databases.some(({stores}) =>
      stores.some(({records}) => records.length > 0)
    )
  )
}

function readMarker(fs, markerPath) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    return marker && typeof marker === 'object' ? marker : {}
  } catch {
    return {}
  }
}

function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs} ms`)),
        timeoutMs
      )
    }),
  ]).finally(() => clearTimeout(timer))
}

function removeFolder(fs, folder, logger) {
  try {
    fs.rmSync(folder, {recursive: true, force: true})
  } catch (error) {
    logger.error('cannot delete the renderer storage migration copy', {
      error: describeError(error),
    })
  }
}

// Once per userData folder; a failure is retried at the next starts, MAX_ATTEMPTS in all. Never throws.
// getSourceSession() returns the session of SOURCE_PARTITION; createWindow(session) a hidden window in that
// session, or in the default one without it.
async function migrateRendererStorage({
  appPath,
  userDataPath,
  createWindow,
  getSourceSession,
  fs,
  logger,
  timeoutMs = MIGRATION_TIMEOUT_MS,
}) {
  const markerPath = path.join(userDataPath, MIGRATION_MARKER_FILE)
  const marker = readMarker(fs, markerPath)
  const attempts = Number.isInteger(marker.attempts) ? marker.attempts : 0
  // Where Electron keeps the files of SOURCE_PARTITION. The copy goes there before the session exists: a
  // session opens its localStorage database when it is created and would not see a later copy.
  const copyPath = path.join(userDataPath, 'Partitions', SOURCE_PARTITION_NAME)
  // A copy a run could not delete (a file still open, on Windows): no session holds it now.
  if (fs.existsSync(copyPath)) removeFolder(fs, copyPath, logger)

  if (marker.status === 'done' || attempts >= MAX_ATTEMPTS) {
    return {status: 'skipped'}
  }

  const writeMarker = (value) => {
    try {
      fs.writeFileSync(markerPath, JSON.stringify(value))
    } catch (error) {
      logger.error('cannot write the renderer storage migration marker', error)
    }
  }

  const sourceStorage = SOURCE_STORAGE.filter((folder) =>
    fs.existsSync(path.join(userDataPath, folder))
  )
  if (sourceStorage.length === 0) {
    const result = {status: 'done', found: false}
    writeMarker({...result, attempts: attempts + 1})
    return result
  }

  const windows = []
  let sourceSession
  let stopped = false
  // After a timeout, the steps still running stop at their next await instead of opening another window.
  const openWindow = (windowSession) => {
    if (stopped) throw new Error('stopped')
    const window = createWindow(windowSession)
    windows.push(window)
    return window
  }
  try {
    const result = await withTimeout(
      (async () => {
        for (const folder of sourceStorage) {
          fs.cpSync(
            path.join(userDataPath, folder),
            path.join(copyPath, folder),
            {recursive: true}
          )
        }
        sourceSession = getSourceSession()
        const {storagePath} = sourceSession
        if (
          !storagePath ||
          path.relative(path.resolve(storagePath), path.resolve(copyPath))
        ) {
          throw new Error(
            `export: the copy session keeps its files in ${storagePath}`
          )
        }

        const source = openWindow(sourceSession)
        await loadPage(
          source,
          'export',
          pathToFileURL(path.join(rendererRoot(appPath), MIGRATION_PAGE)).href
        )
        const exported = await runInPage(
          source,
          'export',
          pageScript(exportRendererStorage, encodeStorageValue)
        )
        if (!hasStorage(exported)) return {status: 'done', found: false}

        const target = openWindow()
        await loadPage(target, 'import', `${RENDERER_ORIGIN}/${MIGRATION_PAGE}`)
        const report = await runInPage(
          target,
          'import',
          pageScript(
            importRendererStorage,
            decodeStorageValue,
            JSON.stringify(exported)
          )
        )
        return {status: 'done', found: true, ...report}
      })(),
      timeoutMs
    )
    writeMarker({...result, attempts: attempts + 1})
    logger.info('renderer storage migration', result)
    return result
  } catch (error) {
    const message = describeError(error)
    writeMarker({status: 'failed', attempts: attempts + 1, error: message})
    logger.error('renderer storage migration failed', {
      attempt: attempts + 1,
      error: message,
    })
    return {status: 'failed', error: message}
  } finally {
    stopped = true
    for (const window of windows) {
      try {
        if (!window.isDestroyed()) window.destroy()
      } catch (error) {
        logger.error('cannot close a renderer storage migration window', error)
      }
    }
    if (sourceSession) {
      try {
        await withTimeout(sourceSession.clearStorageData(), CLEAR_TIMEOUT_MS)
      } catch (error) {
        logger.error('cannot clear the renderer storage migration session', {
          error: describeError(error),
        })
      }
    }
    removeFolder(fs, copyPath, logger)
  }
}

module.exports = {
  MAX_ATTEMPTS,
  MIGRATION_MARKER_FILE,
  MIGRATION_PAGE,
  SOURCE_PARTITION,
  SOURCE_STORAGE,
  decodeStorageValue,
  encodeStorageValue,
  exportRendererStorage,
  importRendererStorage,
  migrateRendererStorage,
}
