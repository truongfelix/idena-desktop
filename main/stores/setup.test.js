const {spawn} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const low = require('lowdb')
const {PRIVATE_FILE_MODE} = require('../private-files')
const {createPrivateFileAdapter} = require('./setup')

describe('persistent store file permissions', () => {
  const testOnPosix = process.platform === 'win32' ? it.skip : it

  testOnPosix('repairs permissions after every atomic write', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-store-'))
    const file = path.join(directory, 'settings.json')

    try {
      const store = low(createPrivateFileAdapter(file))
      store.setState({internalApiKey: 'test-only'}).write()
      fs.chmodSync(file, 0o644)

      store.set('lng', 'en').write()

      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(file).mode & 0o777).toBe(PRIVATE_FILE_MODE)
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })
})

const {readStore, writeFileAtomic, damagedStores} = require('./setup')

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'idena-store-'))
}

function asideFiles(directory, name) {
  return fs
    .readdirSync(directory)
    .filter((file) => file.startsWith(`${name}.broken-`))
}

// B-177: a power cut while a flip draft was saved left flips.json damaged, and the app showed only "Application
// error" at every start.
describe('a damaged store file', () => {
  for (const [kind, content] of [
    ['full of NUL bytes', Buffer.alloc(4096)],
    [
      'cut in the middle',
      '{"flips":[{"id":"a","images":["data:image/png;base64,iVBOR',
    ],
  ]) {
    it(`${kind} is put aside and its store starts empty`, () => {
      const directory = tempDirectory()
      const file = path.join(directory, 'flips.json')
      try {
        fs.writeFileSync(file, content)
        const before = damagedStores().length

        const store = low(createPrivateFileAdapter(file))
        store.defaults({flips: []}).write()

        expect(store.get('flips').value()).toEqual([])
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({flips: []})
        const aside = asideFiles(directory, 'flips.json')
        expect(aside).toHaveLength(1)
        expect(fs.readFileSync(path.join(directory, aside[0]))).toEqual(
          Buffer.from(content)
        )
        expect(damagedStores().slice(before)).toEqual([
          {file: 'flips.json', aside: path.join(directory, aside[0])},
        ])
      } finally {
        fs.rmSync(directory, {force: true, recursive: true})
      }
    })
  }

  it('reads an empty or missing file as an empty store, without putting it aside', () => {
    const directory = tempDirectory()
    const file = path.join(directory, 'settings.json')
    try {
      expect(readStore(file)).toEqual({})
      fs.writeFileSync(file, '  \n')
      expect(readStore(file)).toEqual({})
      expect(asideFiles(directory, 'settings.json')).toEqual([])
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })

  // The window saves some states whole (persistState): the flips' filter as a string, the validation in
  // progress as null once cleared, at each ceremony. They are sound, not damaged.
  for (const [name, value] of [
    ['flipFilter', 'Active'],
    ['validation2', null],
    ['list', [1, 2, 3]],
  ]) {
    it(`reads back a store saved as ${JSON.stringify(value)}`, () => {
      const directory = tempDirectory()
      const file = path.join(directory, `${name}.json`)
      try {
        const before = damagedStores().length
        low(createPrivateFileAdapter(file)).setState(value).write()
        expect(low(createPrivateFileAdapter(file)).getState()).toEqual(value)
        expect(asideFiles(directory, `${name}.json`)).toEqual([])
        expect(damagedStores()).toHaveLength(before)
      } finally {
        fs.rmSync(directory, {force: true, recursive: true})
      }
    })
  }

  it('leaves a file the other process replaced meanwhile', () => {
    const directory = tempDirectory()
    const file = path.join(directory, 'settings.json')
    try {
      fs.writeFileSync(file, Buffer.alloc(64))
      let reads = 0
      const replacedMeanwhile = {
        ...fs,
        readFileSync: (...args) => {
          reads += 1
          // The other process puts the damaged file aside and writes a sound one right after this read.
          if (reads === 2) fs.writeFileSync(file, '{"lng":"fr"}')
          return fs.readFileSync(...args)
        },
      }
      // Its data, not an empty store that the next write would put over it.
      expect(readStore(file, replacedMeanwhile)).toEqual({lng: 'fr'})
      expect(fs.readFileSync(file, 'utf8')).toBe('{"lng":"fr"}')
      expect(asideFiles(directory, 'settings.json')).toEqual([])
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })

  it('reads a file a Windows editor saved with a byte order mark', () => {
    const directory = tempDirectory()
    const file = path.join(directory, 'settings.json')
    try {
      fs.writeFileSync(file, '\uFEFF{"useExternalNode":true}')
      expect(readStore(file)).toEqual({useExternalNode: true})
      expect(asideFiles(directory, 'settings.json')).toEqual([])
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })

  it('keeps a copy of a damaged file it cannot read again', () => {
    const directory = tempDirectory()
    const file = path.join(directory, 'flips.json')
    const damaged = '{"flips":[{"id":"a","images":["data:image/png;base64,iVBOR'
    try {
      fs.writeFileSync(file, damaged)
      let reads = 0
      const flaky = {
        ...fs,
        readFileSync: (...args) => {
          reads += 1
          if (reads === 2)
            throw Object.assign(new Error('busy'), {code: 'EBUSY'})
          return fs.readFileSync(...args)
        },
      }
      expect(readStore(file, flaky)).toEqual({})
      const aside = asideFiles(directory, 'flips.json')
      expect(aside).toHaveLength(1)
      expect(fs.readFileSync(path.join(directory, aside[0]), 'utf8')).toBe(
        damaged
      )
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })

  it('reads a sound file as it is', () => {
    const directory = tempDirectory()
    const file = path.join(directory, 'invites.json')
    try {
      fs.writeFileSync(file, JSON.stringify({invites: [{id: 'x'}]}))
      expect(readStore(file)).toEqual({invites: [{id: 'x'}]})
      expect(asideFiles(directory, 'invites.json')).toEqual([])
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })
})

describe('a store write', () => {
  const OLD = JSON.stringify({flips: [{id: 'old'}]})

  function withStore(test) {
    const directory = tempDirectory()
    const file = path.join(directory, 'flips.json')
    fs.writeFileSync(file, OLD)
    try {
      test(file, directory)
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  }

  it('cut before its rename leaves the old file whole, and no temporary file', () => {
    withStore((file, directory) => {
      const cut = {
        ...fs,
        renameSync: () => {
          throw Object.assign(new Error('power cut'), {code: 'EIO'})
        },
      }
      expect(() => writeFileAtomic(file, '{"flips":[]}', cut)).toThrow(
        'power cut'
      )
      expect(fs.readFileSync(file, 'utf8')).toBe(OLD)
      expect(fs.readdirSync(directory)).toEqual(['flips.json'])
    })
  })

  it('cut while writing its temporary file leaves the old file whole', () => {
    withStore((file) => {
      const cut = {
        ...fs,
        writeFileSync: (fd, text) => {
          fs.writeFileSync(fd, text.slice(0, 5))
          throw Object.assign(new Error('power cut'), {code: 'EIO'})
        },
      }
      expect(() =>
        writeFileAtomic(file, JSON.stringify({flips: []}), cut)
      ).toThrow('power cut')
      expect(fs.readFileSync(file, 'utf8')).toBe(OLD)
    })
  })

  it('fails on a full disk without leaving a temporary file', () => {
    withStore((file, directory) => {
      const full = {
        ...fs,
        fsyncSync: () => {
          throw Object.assign(new Error('no space'), {code: 'ENOSPC'})
        },
      }
      expect(() => writeFileAtomic(file, '{"flips":[]}', full)).toThrow(
        'no space'
      )
      expect(fs.readFileSync(file, 'utf8')).toBe(OLD)
      expect(fs.readdirSync(directory)).toEqual(['flips.json'])
    })
  })

  it('writes in place when Windows keeps refusing the rename, rather than losing the change', () => {
    withStore((file, directory) => {
      const held = {
        ...fs,
        renameSync: () => {
          throw Object.assign(new Error('held open'), {code: 'EPERM'})
        },
      }
      writeFileAtomic(file, '{"flips":[]}', held)
      expect(fs.readFileSync(file, 'utf8')).toBe('{"flips":[]}')
      expect(fs.readdirSync(directory)).toEqual(['flips.json'])
    })
  })

  it('retries a rename Windows refuses for a moment', () => {
    withStore((file) => {
      let refusals = 7
      const busy = {
        ...fs,
        renameSync: (from, to) => {
          if (refusals > 0) {
            refusals -= 1
            throw Object.assign(new Error('busy'), {code: 'EPERM'})
          }
          return fs.renameSync(from, to)
        },
      }
      writeFileAtomic(file, '{"flips":[]}', busy)
      expect(fs.readFileSync(file, 'utf8')).toBe('{"flips":[]}')
    })
  })

  it('leaves a temporary file of a cut write behind only until a read finds it old', () => {
    withStore((file, directory) => {
      const old = `${file}.1234.tmp`
      const fresh = `${file}.5678.tmp`
      fs.writeFileSync(old, '{"fl')
      fs.writeFileSync(fresh, '{"fl')
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
      fs.utimesSync(old, hourAgo, hourAgo)
      readStore(file)
      expect(fs.readdirSync(directory).sort()).toEqual(
        ['flips.json', path.basename(fresh)].sort()
      )
    })
  })
})

// A process killed while it writes (as a power cut stops it): the file must read whole at any moment. lowdb's own
// FileSync, used before, truncates the file and then writes it, and fails this.
const testOnPosixOnly = process.platform === 'win32' ? it.skip : it
testOnPosixOnly(
  'a store killed at random moments while writing reads whole',
  async () => {
    const directory = tempDirectory()
    const file = path.join(directory, 'flips.json')
    const writer = `
    const low = require('lowdb')
    const {createPrivateFileAdapter} = require(${JSON.stringify(
      path.join(__dirname, 'setup.js')
    )})
    const store = low(createPrivateFileAdapter(process.argv[1]))
    const image = 'x'.repeat(2 * 1024 * 1024)
    for (let i = 0; ; i += 1) store.set('flips', [{id: String(i), images: [image]}]).write()
  `
    try {
      for (let round = 0; round < 12; round += 1) {
        const child = spawn(process.execPath, ['-e', writer, file], {
          cwd: path.join(__dirname, '..', '..'),
          stdio: 'ignore',
        })
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 150 + round * 37)
        })
        child.kill('SIGKILL')
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          child.on('exit', resolve)
        })
        if (fs.existsSync(file)) {
          const data = JSON.parse(fs.readFileSync(file, 'utf8'))
          expect(Array.isArray(data.flips)).toBe(true)
        }
      }
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  },
  60000
)
