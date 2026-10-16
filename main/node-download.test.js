const crypto = require('crypto')
const os = require('os')
const path = require('path')
const {Readable} = require('stream')
const EventEmitter = require('events')

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
jest.mock('axios', () => ({get: jest.fn(), request: jest.fn()}))

const fs = require('fs-extra')
const axios = require('axios')
const {spawn} = require('child_process')
const {MIN_NODE_BINARY_SIZE} = require('./node-download-safety')
const {downloadNode, getNodeFile} = require('./idena-node')

const BUNDLED_VERSION = '1.1.2'
const RELEASE_VERSION = '1.1.3'
const ASSET = `idena-node-linux-${RELEASE_VERSION}`
const RELEASE_URL = `https://github.com/truongfelix/idena-go/releases/download/v${RELEASE_VERSION}/${ASSET}`

const bundledNode = Buffer.alloc(MIN_NODE_BINARY_SIZE + 1, 'b')
const releasedNode = Buffer.alloc(MIN_NODE_BINARY_SIZE + 2, 'r')

// A node binary answering --version: the bundled one says 1.1.2, any other (the download) 1.1.3.
function versionChild(binaryPath) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = jest.fn()
  const version = binaryPath.startsWith(process.resourcesPath)
    ? BUNDLED_VERSION
    : RELEASE_VERSION
  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(`idena-go version ${version}\n`))
    child.emit('close', 0, null)
  })
  return child
}

// The latest release on GitHub: v1.1.3 with this platform's asset and its checksum.
function releaseFeed() {
  const sha256 = crypto.createHash('sha256').update(releasedNode).digest('hex')
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/releases/latest')) {
      return {
        data: {
          tag_name: `v${RELEASE_VERSION}`,
          assets: [
            {name: ASSET, browser_download_url: RELEASE_URL},
            {
              name: `${ASSET}.sha256`,
              browser_download_url: `${RELEASE_URL}.sha256`,
            },
          ],
        },
      }
    }
    if (url === `${RELEASE_URL}.sha256`) return {data: `${sha256}  ${ASSET}\n`}
    throw new Error(`unexpected request ${url}`)
  })
  axios.request.mockImplementation(async ({url}) => {
    if (url !== RELEASE_URL) throw new Error(`unexpected download ${url}`)
    return {
      headers: {'content-length': String(releasedNode.length)},
      data: Readable.from([releasedNode]),
    }
  })
}

const tempNodeFile = () =>
  path.join(path.dirname(getNodeFile()), `new-${path.basename(getNodeFile())}`)

// The asset names and the bundled node's name are those of Linux x64.
const onLinuxX64 = process.platform === 'linux' && process.arch === 'x64'

;(onLinuxX64 ? describe : describe.skip)('node download', () => {
  const {resourcesPath} = process

  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-download-'))
    process.resourcesPath = path.join(mockUserData, 'resources')
    await fs.outputFile(
      path.join(process.resourcesPath, 'node', 'idena-go'),
      bundledNode
    )
    spawn.mockImplementation(versionChild)
    releaseFeed()
  })

  afterEach(async () => {
    process.resourcesPath = resourcesPath
    jest.clearAllMocks()
    await fs.remove(mockUserData)
  })

  it('downloads the release when the bundled node is older than the update', async () => {
    await expect(
      downloadNode(jest.fn(), {minVersion: RELEASE_VERSION})
    ).resolves.toBe(RELEASE_VERSION)
    expect(axios.request).toHaveBeenCalledTimes(1)
    expect((await fs.readFile(tempNodeFile())).equals(releasedNode)).toBe(true)
  })

  it('copies the bundled node when no node is installed', async () => {
    await expect(downloadNode(jest.fn())).resolves.toBe(BUNDLED_VERSION)
    expect(axios.request).not.toHaveBeenCalled()
    expect((await fs.readFile(tempNodeFile())).equals(bundledNode)).toBe(true)
  })

  it('copies the bundled node when it is the version the update asks for', async () => {
    await expect(
      downloadNode(jest.fn(), {minVersion: BUNDLED_VERSION})
    ).resolves.toBe(BUNDLED_VERSION)
    expect(axios.request).not.toHaveBeenCalled()
  })
})
