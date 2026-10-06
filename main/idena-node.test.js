const EventEmitter = require('events')
const os = require('os')
const path = require('path')

let mockUserData = ''
jest.mock('./app-data-path', () => () => mockUserData)
jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}))
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}))

const fs = require('fs-extra')
const {spawn} = require('child_process')
const logger = require('./logger')
const {
  getBinaryHelp,
  getCurrentVersion,
  getNodeFile,
  updateNode,
} = require('./idena-node')

function scriptedChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = jest.fn()
  return child
}

function spawnChild() {
  const child = scriptedChild()
  spawn.mockReturnValueOnce(child)
  return child
}

describe('node version', () => {
  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('reads the whole output, also when it comes in pieces', async () => {
    const child = spawnChild()
    const version = getCurrentVersion()
    child.stdout.emit('data', Buffer.from('idena-go version 1.'))
    child.stdout.emit('data', Buffer.from('1.2\n'))
    child.emit('exit', 0, null)
    child.emit('close', 0, null)
    await expect(version).resolves.toBe('1.1.2')
  })

  it('rejects an output without a version', async () => {
    const child = spawnChild()
    const version = getCurrentVersion()
    child.stdout.emit('data', Buffer.from('usage: something else\n'))
    child.emit('close', 0, null)
    await expect(version).rejects.toThrow('cannot resolve node version')
  })

  it('rejects a binary that exits without output', async () => {
    const child = spawnChild()
    const version = getCurrentVersion()
    child.emit('close', 0, null)
    await expect(version).rejects.toThrow('cannot resolve node version')
  })

  it('rejects a binary that dies on a signal', async () => {
    const child = spawnChild()
    const version = getCurrentVersion()
    child.stdout.emit('data', Buffer.from('idena-go version 1.1.2\n'))
    child.emit('close', null, 'SIGKILL')
    await expect(version).rejects.toThrow('SIGKILL')
  })

  it('rejects a binary that cannot start', async () => {
    const child = spawnChild()
    const version = getCurrentVersion()
    child.emit(
      'error',
      Object.assign(new Error('spawn ENOENT'), {code: 'ENOENT'})
    )
    child.emit('close', -2, null)
    await expect(version).rejects.toThrow('ENOENT')
  })

  it('kills and rejects a binary that does not answer', async () => {
    jest.useFakeTimers()
    const child = spawnChild()
    const version = getCurrentVersion()
    jest.advanceTimersByTime(30 * 1000)
    await expect(version).rejects.toThrow('no answer')
    expect(child.kill).toHaveBeenCalled()
  })

  it('asks the new node file for the temp version', async () => {
    const child = spawnChild()
    const version = getCurrentVersion(true)
    child.stdout.emit('data', Buffer.from('idena-go version 1.2.0\n'))
    child.emit('close', 0, null)
    await expect(version).resolves.toBe('1.2.0')
    expect(path.basename(spawn.mock.calls[0][0])).toMatch(/^new-idena-go/)
  })
})

describe('node help', () => {
  afterEach(() => jest.clearAllMocks())

  it('reads the output that comes after the exit', async () => {
    const child = spawnChild()
    const help = getBinaryHelp('/node')
    child.stdout.emit('data', Buffer.from('--datadir value\n'))
    child.emit('exit', 0, null)
    child.stdout.emit('data', Buffer.from('--dbwritebuffer value\n'))
    child.emit('close', 0, null)
    await expect(help).resolves.toContain('--dbwritebuffer')
  })

  it('answers empty for a binary that cannot start', async () => {
    const child = spawnChild()
    const help = getBinaryHelp('/node')
    child.emit('error', new Error('spawn ENOENT'))
    await expect(help).resolves.toBe('')
  })
})

describe('node replacement', () => {
  let installed
  let incoming

  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-node-'))
    installed = getNodeFile()
    incoming = path.join(
      path.dirname(installed),
      `new-${path.basename(installed)}`
    )
    await fs.outputFile(installed, 'old node')
    await fs.outputFile(incoming, 'new node')
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    await fs.remove(mockUserData)
  })

  it('puts the new node in place of the installed one', async () => {
    await updateNode()
    expect(await fs.readFile(installed, 'utf8')).toBe('new node')
    expect(await fs.pathExists(incoming)).toBe(false)
    if (process.platform !== 'win32') {
      // eslint-disable-next-line no-bitwise
      expect((await fs.stat(installed)).mode & 0o777).toBe(0o755)
    }
  })

  it('tries again after a pause when the file is busy', async () => {
    const busy = Object.assign(new Error('EBUSY: resource busy'), {
      code: 'EBUSY',
    })
    const rename = jest.spyOn(fs, 'rename').mockRejectedValueOnce(busy)
    const started = Date.now()
    await updateNode({retryDelayMs: 100})
    expect(Date.now() - started).toBeGreaterThanOrEqual(90)
    expect(rename).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(installed, 'utf8')).toBe('new node')
  })

  it('gives up after its attempts and says why', async () => {
    const rename = jest
      .spyOn(fs, 'rename')
      .mockRejectedValue(new Error('EPERM: operation not permitted'))
    await expect(updateNode({attempts: 3, retryDelayMs: 0})).rejects.toThrow(
      'cannot replace the idena-go file: EPERM'
    )
    expect(rename).toHaveBeenCalledTimes(3)
    expect(await fs.readFile(incoming, 'utf8')).toBe('new node')
  })

  it('leaves the installed node alone without a new one', async () => {
    await fs.remove(incoming)
    await expect(updateNode()).rejects.toThrow('no new idena-go file')
    expect(await fs.readFile(installed, 'utf8')).toBe('old node')
  })

  it('installs the new node where none is installed', async () => {
    await fs.remove(installed)
    await updateNode()
    expect(await fs.readFile(installed, 'utf8')).toBe('new node')
  })
})
