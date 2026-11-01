/* eslint-disable import/no-extraneous-dependencies */
const path = require('path')

let electron = {}
try {
  // eslint-disable-next-line global-require
  electron = require('electron') || {}
} catch {
  electron = {}
}
const low = require('lowdb')
const fs = require('fs')
const {APP_PATH_COMMAND} = require('../channels')
const {hardenPrivateDirectory, hardenPrivateFile} = require('../private-files')

const app = electron.app || null
const ipcRenderer = electron.ipcRenderer || null

function getUserDataPath() {
  let userDataPath
  if (app) {
    userDataPath = app.getPath('userData')
  } else {
    if (!ipcRenderer || typeof ipcRenderer.sendSync !== 'function') {
      throw new Error('Electron app path IPC is unavailable')
    }
    userDataPath = ipcRenderer.sendSync(APP_PATH_COMMAND, 'userData')
  }

  if (!userDataPath) throw new Error('Electron user data path is unavailable')
  fs.mkdirSync(userDataPath, {mode: 0o700, recursive: true})
  hardenPrivateDirectory(userDataPath)
  return userDataPath
}

function dbPath(fileDb) {
  return path.join(getUserDataPath(), fileDb)
}

// Each store is a JSON file in the user data folder, written whole at every change. lowdb's FileSync wrote it in
// place: a power cut during a write left it cut or full of NUL bytes, and reading it threw at every start, before the
// window had anything (B-177: a Windows user's flips.json, cut while a flip was being made). A write now goes to a
// temporary file, synced, then renamed over the store, so that a cut leaves the old file or the new one; a file
// damaged anyway (a disk error, a version before this one) is put aside and its store starts empty.

/** The stores this process found damaged and put aside: {file, aside} each, for the window to tell the user. */
const damagedStores = []

// A temporary file older than this was left by a cut write: no write takes that long.
const LEFTOVER_TEMP_MS = 10 * 60 * 1000

function pause(ms) {
  // Sync code (lowdb), in the window too, where Atomics.wait is refused: a few milliseconds at most.
  const until = Date.now() + ms
  while (Date.now() < until);
}

function renameOver(from, to, fileSystem) {
  // Windows refuses to replace a file another process holds open for a moment (an antivirus, an indexer, a
  // backup): about a second of retries in all.
  for (let attempt = 1; ; attempt += 1) {
    try {
      fileSystem.renameSync(from, to)
      return
    } catch (error) {
      const busy = ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)
      if (!busy || attempt >= 10) throw error
      pause(20 * attempt)
    }
  }
}

function syncDirectory(directory, fileSystem) {
  if (process.platform === 'win32') return
  try {
    const fd = fileSystem.openSync(directory, 'r')
    try {
      fileSystem.fsyncSync(fd)
    } finally {
      fileSystem.closeSync(fd)
    }
  } catch {
    // Best effort: the rename itself is what keeps the file whole.
  }
}

/** Writes text to filePath so that a cut at any point leaves the old file or the new one whole. */
function writeFileAtomic(filePath, text, fileSystem = fs) {
  // Own name per process: the main process and the window write settings.json both.
  const temporary = `${filePath}.${process.pid}.tmp`
  const removeTemporary = () => {
    try {
      fileSystem.unlinkSync(temporary)
    } catch {
      // Left for removeLeftoverTemporaries.
    }
  }
  const fd = fileSystem.openSync(temporary, 'w', 0o600)
  try {
    fileSystem.writeFileSync(fd, text)
    fileSystem.fsyncSync(fd)
  } catch (error) {
    // A full disk or a disk error: no partial copy of the store left behind.
    fileSystem.closeSync(fd)
    removeTemporary()
    throw error
  }
  fileSystem.closeSync(fd)
  try {
    renameOver(temporary, filePath, fileSystem)
  } catch (error) {
    removeTemporary()
    // Windows refused the rename for a second (another program holds the store open without letting it be
    // replaced): written in place, as before atomic writes, rather than losing the change.
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error
    fileSystem.writeFileSync(filePath, text)
  }
  syncDirectory(path.dirname(filePath), fileSystem)
}

// The stores whose leftovers this process looked for: once each (the window opens a store at every call).
const cleanedStores = new Set()

function removeLeftoverTemporaries(filePath, fileSystem, now) {
  if (cleanedStores.has(filePath)) return
  cleanedStores.add(filePath)
  const directory = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}.`
  let names = []
  try {
    names = fileSystem.readdirSync(directory)
  } catch {
    return
  }
  const leftovers = names.filter(
    (name) => name.startsWith(prefix) && name.endsWith('.tmp')
  )
  for (const name of leftovers) {
    const temporary = path.join(directory, name)
    try {
      if (now - fileSystem.statSync(temporary).mtimeMs > LEFTOVER_TEMP_MS) {
        fileSystem.unlinkSync(temporary)
      }
    } catch {
      // Another process removed or renamed it.
    }
  }
}

// Strips the byte order mark some Windows editors put first: FileSync's trim() did, JSON.parse refuses it.
const withoutBom = (text) => text.replace(/^\uFEFF/, '')

/**
 * Puts a damaged store file aside; returns the store's data: {} for the damaged one, or the data of a sound file the
 * other process (main or window) wrote meanwhile, which stays.
 */
function putAside(filePath, damagedText, fileSystem, now) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const aside = `${filePath}.broken-${stamp}`
  let current
  try {
    current = fileSystem.readFileSync(filePath, 'utf8')
  } catch (error) {
    // Gone: the other process put it aside first. Not readable again for a moment: a copy of what was read is kept
    // all the same, so that the next write does not take the only one.
    if (error?.code !== 'ENOENT') {
      try {
        fileSystem.writeFileSync(aside, damagedText)
        damagedStores.push({file: path.basename(filePath), aside})
      } catch {
        // Nothing more to do: the store starts empty.
      }
    }
    return {}
  }
  if (current !== damagedText) {
    try {
      return JSON.parse(withoutBom(current))
    } catch {
      return {}
    }
  }
  try {
    renameOver(filePath, aside, fileSystem)
  } catch (error) {
    // The other process (main or window) put it aside first.
    if (error?.code === 'ENOENT') return {}
    throw error
  }
  damagedStores.push({file: path.basename(filePath), aside})
  return {}
}

/**
 * The store's data: {} for a missing or empty file; a file that is not JSON (cut, NUL bytes) is put aside and read as
 * {}. Any JSON value is the store's data as it is, as FileSync read it: the window saves some states whole, a filter's
 * name ("Active") or null (validation2 cleared at each ceremony). Throws only when the file cannot be read at all
 * (permissions, a disk error).
 */
function readStore(filePath, fileSystem = fs, now = Date.now()) {
  removeLeftoverTemporaries(filePath, fileSystem, now)
  let text
  try {
    text = fileSystem.readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
  if (text.trim() === '') return {}
  try {
    return JSON.parse(withoutBom(text))
  } catch {
    return putAside(filePath, text, fileSystem, now)
  }
}

function createPrivateFileAdapter(filePath, fileSystem = fs) {
  return {
    read() {
      const data = readStore(filePath, fileSystem)
      hardenPrivateFile(filePath)
      return data
    },
    write(data) {
      writeFileAtomic(filePath, JSON.stringify(data, null, 2), fileSystem)
      hardenPrivateFile(filePath)
    },
  }
}

module.exports = {
  dbPath,
  createPrivateFileAdapter,
  readStore,
  writeFileAtomic,
  damagedStores() {
    return damagedStores.map((store) => ({...store}))
  },
  prepareDb(name) {
    const adapter = createPrivateFileAdapter(dbPath(`${name}.json`))
    return low(adapter)
  },
  checkDbExists(name) {
    return fs.existsSync(dbPath(`${name}.json`))
  },
}
