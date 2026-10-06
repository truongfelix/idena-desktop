/* eslint-disable no-console */
const path = require('path')
const fs = require('fs-extra')
const {spawn} = require('child_process')
const axios = require('axios')
const progress = require('progress-stream')
const semver = require('semver')
const lineReader = require('reverse-line-reader')
// eslint-disable-next-line import/no-extraneous-dependencies
const appDataPath = require('./app-data-path')
const logger = require('./logger')
const {
  MIN_NODE_BINARY_SIZE,
  assertSafeNodeDownloadUrl,
  parseNodeChecksum,
  validateDownloadedNode,
} = require('./node-download-safety')
const {
  dbWriteBufferArgs,
  nodeSupportsWriteBuffer,
  ipfsWriteBufferArgs,
  nodeSupportsIpfsWriteBuffer,
} = require('./node-write-buffer')
const {
  DEFAULT_PEER_LEVEL,
  DEFAULT_IPFS_CONNECTIONS,
  ipfsConnectionsFor,
  nodeSupportsPeerLimits,
  peerLimitArgs,
} = require('./node-peers')
const {shouldReplaceInstalledNode, sha256File} = require('./bundled-node')
const {fetchHardForkInfo} = require('./hard-fork-info')

const idenaBin = 'idena-go'
const pinnedNodeVersion = '1.1.2'
const idenaNodeReleasesUrl =
  'https://api.github.com/repos/truongfelix/idena-go/releases/latest'
const idenaChainDbFolder = 'idenachain.db'
const VERSION_TIMEOUT_MS = 30 * 1000
const REPLACE_ATTEMPTS = 5
const REPLACE_RETRY_DELAY_MS = 1000

const getBinarySuffix = () => (process.platform === 'win32' ? '.exe' : '')

const getNodeDir = () => path.join(appDataPath('userData'), 'node')

const getNodeDataDir = () => path.join(getNodeDir(), 'datadir')

const getNodeFile = () => path.join(getNodeDir(), idenaBin + getBinarySuffix())

const getNodeConfigFile = () => path.join(getNodeDir(), 'config.json')

const getTempNodeFile = () =>
  path.join(getNodeDir(), `new-${idenaBin}${getBinarySuffix()}`)

function getBundledNodeFileCandidates() {
  const suffix = getBinarySuffix()
  const candidates = []

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'node', idenaBin + suffix))
  }

  candidates.push(
    path.resolve(
      __dirname,
      '..',
      'build',
      'node',
      'current',
      idenaBin + suffix
    ),
    path.resolve(process.cwd(), 'build', 'node', 'current', idenaBin + suffix),
    path.resolve(__dirname, '..', 'node', idenaBin + suffix),
    path.resolve(__dirname, '..', '..', 'node', idenaBin + suffix)
  )

  return candidates
}

async function findBundledNodeFile() {
  for (const candidate of getBundledNodeFileCandidates()) {
    try {
      const stats = await fs.stat(candidate)
      if (stats && stats.size >= MIN_NODE_BINARY_SIZE) {
        return candidate
      }
    } catch (_) {
      // Try the next candidate.
    }
  }

  return null
}

// The node's --help text ('' when it cannot be read), to know the flags this binary has.
function getBinaryHelp(binaryPath) {
  return new Promise((resolve) => {
    const help = spawn(binaryPath, ['--help'])
    let output = ''
    help.stdout.on('data', (data) => {
      output += data.toString()
    })
    help.stderr.on('data', (data) => {
      output += data.toString()
    })
    help.on('error', () => resolve(''))
    help.on('exit', () => resolve(output))
  })
}

// The version a node binary prints for --version. It settles once the binary has exited and its output is read,
// on a spawn error, or after `timeoutMs` (the binary is killed): a binary that hangs, dies on a signal or prints
// no version rejects instead of leaving the caller waiting.
function getBinaryVersion(binaryPath, timeoutMs = VERSION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let nodeVersion
    try {
      nodeVersion = spawn(binaryPath, ['--version'])
    } catch (e) {
      reject(e)
      return
    }
    let output = ''
    const timer = setTimeout(() => {
      nodeVersion.kill()
      reject(
        new Error(`cannot resolve node version, no answer in ${timeoutMs} ms`)
      )
    }, timeoutMs)
    const fail = (err) => {
      clearTimeout(timer)
      reject(err)
    }

    nodeVersion.stdout.on('data', (data) => {
      output += data.toString()
    })
    nodeVersion.stderr.on('data', (data) => {
      output += data.toString()
    })
    nodeVersion.on('error', fail)
    // 'close', not 'exit': at 'exit' the output can still be unread.
    nodeVersion.on('close', (code, signal) => {
      if (code !== 0) {
        fail(
          new Error(
            `cannot resolve node version, exit code ${code}${
              signal ? ` (${signal})` : ''
            }`
          )
        )
        return
      }

      const coerced = semver.coerce(output)
      if (!coerced || !semver.valid(coerced.version)) {
        fail(new Error(`cannot resolve node version, output: ${output}`))
        return
      }

      clearTimeout(timer)
      resolve(coerced.version)
    })
  })
}

async function copyBundledNode(tempNodeFile, onProgress) {
  const bundledNodeFile = await findBundledNodeFile()

  if (!bundledNodeFile) {
    return null
  }

  const version = await getBinaryVersion(bundledNodeFile)

  if (version !== pinnedNodeVersion) {
    logger.warn('ignoring incompatible bundled node binary', {
      bundledNodeFile,
      version,
      expected: pinnedNodeVersion,
    })
    return null
  }

  const stats = await fs.stat(bundledNodeFile)

  if (onProgress) {
    onProgress({
      version,
      percentage: 5,
      transferred: 0,
      length: stats.size,
      eta: 0,
      runtime: 0,
      speed: 0,
      stage: 'bundled-copy-start',
    })
  }

  await fs.copy(bundledNodeFile, tempNodeFile, {overwrite: true})

  if (process.platform !== 'win32') {
    await fs.chmod(tempNodeFile, '755')
  }

  if (onProgress) {
    onProgress({
      version,
      percentage: 100,
      transferred: stats.size,
      length: stats.size,
      eta: 0,
      runtime: 0,
      speed: 0,
      stage: 'bundled-copy-complete',
    })
  }

  logger.info('prepared Idena node from bundled binary', {bundledNodeFile})

  return version
}

const getNodeChainDbFolder = () =>
  path.join(getNodeDataDir(), idenaChainDbFolder)

const getNodeIpfsDir = () => path.join(getNodeDataDir(), 'ipfs')

const getNodeLogsFile = () => path.join(getNodeDataDir(), 'logs', 'output.log')

const getNodeErrorFile = () => path.join(getNodeDataDir(), 'logs', 'error.log')

function getNodeAssetName(version) {
  let assetPrefix = 'idena-node-linux'
  if (process.platform === 'win32' && process.arch === 'x64') {
    assetPrefix = 'idena-node-win'
  } else if (process.platform === 'darwin' && process.arch === 'arm64') {
    assetPrefix = 'idena-node-mac-arm64'
  } else if (process.platform === 'darwin' && process.arch === 'x64') {
    assetPrefix = 'idena-node-mac'
  } else if (process.platform === 'linux' && process.arch === 'arm64') {
    assetPrefix = 'idena-node-linux-aarch64'
  } else if (process.platform !== 'linux' || process.arch !== 'x64') {
    return null
  }

  return `${assetPrefix}-${version}${
    process.platform === 'win32' ? '.exe' : ''
  }`
}

const getReleaseInfo = async ({withHardFork = false} = {}) => {
  const {data} = await axios.get(idenaNodeReleasesUrl)
  const version = semver.clean(data.tag_name)
  const assetName = version && getNodeAssetName(version)
  if (!version || !assetName) {
    return null
  }

  const asset = data.assets.find((candidate) => candidate.name === assetName)
  const checksumAsset = data.assets.find(
    (candidate) => candidate.name === `${assetName}.sha256`
  )
  if (!asset || !checksumAsset) {
    return null
  }

  const url = assertSafeNodeDownloadUrl(asset.browser_download_url)
  const checksumUrl = assertSafeNodeDownloadUrl(
    checksumAsset.browser_download_url
  )
  const {data: checksumData} = await axios.get(checksumUrl, {
    responseType: 'text',
    maxContentLength: 4096,
    maxBodyLength: 4096,
  })

  const releaseInfo = {
    assetName,
    expectedSha256: parseNodeChecksum(String(checksumData), assetName),
    url,
    version,
  }

  if (withHardFork) {
    try {
      releaseInfo.hardFork = await fetchHardForkInfo({
        assets: data.assets,
        version,
        get: axios.get,
      })
    } catch (error) {
      // An unverifiable description shows no hard fork screen; the update itself goes on.
      logger.error('cannot read the hard fork description', error.toString())
      releaseInfo.hardFork = null
    }
  }

  return releaseInfo
}

// The latest node release: its version, and the hard fork it declares (null for an ordinary update).
const getRemoteRelease = async () => {
  const releaseInfo = await getReleaseInfo({withHardFork: true})
  return releaseInfo
    ? {version: releaseInfo.version, hardFork: releaseInfo.hardFork}
    : null
}

async function downloadNode(onProgress) {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      fs.ensureDirSync(getNodeDir())

      const bundledVersion = await copyBundledNode(
        getTempNodeFile(),
        onProgress
      )
      if (bundledVersion) {
        resolve(bundledVersion)
        return
      }

      const releaseInfo = await getReleaseInfo()
      if (!releaseInfo) {
        throw new Error('Verified Idena node release asset was not found')
      }
      const {expectedSha256, url, version} = releaseInfo

      const response = await axios.request({
        method: 'get',
        url,
        responseType: 'stream',
      })
      const contentLength = Number.parseInt(
        response.headers['content-length'],
        10
      )
      if (
        Number.isFinite(contentLength) &&
        contentLength < MIN_NODE_BINARY_SIZE
      ) {
        throw new Error('Idena node download is unexpectedly small')
      }

      const writer = fs.createWriteStream(getTempNodeFile())
      writer.on('finish', () =>
        writer.close(async () => {
          try {
            const validatedVersion = await validateDownloadedNode({
              filePath: getTempNodeFile(),
              expectedVersion: version,
              expectedSha256,
              getBinaryVersion,
              stat: fs.stat,
              chmod: fs.chmod,
            })
            resolve(validatedVersion)
          } catch (err) {
            reject(err)
          }
        })
      )
      writer.on('error', reject)

      const str = progress({
        time: 1000,
        length: contentLength,
      })

      response.data.on('error', reject)
      str.on('error', reject)
      str.on('progress', (p) => {
        onProgress({...p, version})
      })

      response.data.pipe(str).pipe(writer)
    } catch (error) {
      reject(error)
    }
  })
}

function writeError(err) {
  try {
    fs.appendFileSync(
      getNodeErrorFile(),
      `-- node error, time: ${new Date().toUTCString()} --\n${err}\n -- end of error -- \n`
    )
  } catch (e) {
    console.log(`cannot write error to file: ${e.toString()}`)
  }
}

async function startNode(
  port,
  tcpPort,
  ipfsPort,
  apiKey,
  autoActivateMining,
  // The Advanced settings: {dbWriteBufferMiB, ipfsWriteBufferMiB, peerLevel, ipfsConnections}.
  nodeOptions,
  // eslint-disable-next-line default-param-last
  useLogging = true,
  onLog,
  onExit
) {
  const parameters = [
    '--datadir',
    getNodeDataDir(),
    '--rpcport',
    port,
    '--port',
    tcpPort,
    '--ipfsport',
    ipfsPort,
    '--apikey',
    apiKey,
  ]

  const version = await getCurrentVersion(false)

  if (autoActivateMining && semver.gt(version, '0.28.3')) {
    parameters.push('--autoonline')
  }

  const options = nodeOptions || {}
  const help = await getBinaryHelp(getNodeFile())
  const writeBufferArgs = dbWriteBufferArgs(options.dbWriteBufferMiB, help)
  const ipfsBufferArgs = ipfsWriteBufferArgs(options.ipfsWriteBufferMiB, help)
  const peerArgs = peerLimitArgs(
    options.peerLevel,
    options.ipfsConnections,
    help
  )
  parameters.push(...writeBufferArgs, ...ipfsBufferArgs, ...peerArgs)

  const configFile = getNodeConfigFile()
  if (fs.existsSync(configFile)) {
    parameters.push('--config')
    parameters.push(configFile)
  }

  const idenaNode = spawn(getNodeFile(), parameters)

  idenaNode.stdout.on('data', (data) => {
    const str = data.toString()
    if (onLog) onLog(str.split('\n').filter((x) => x))
    if (useLogging) {
      console.log(str)
    }
  })

  idenaNode.stderr.on('data', (err) => {
    const str = err.toString()
    writeError(str)
    if (onLog) onLog(str.split('\n').filter((x) => x))
    if (useLogging) {
      console.error(str)
    }
  })

  // The settings the node runs with: the chosen ones, or idena-go's defaults without the flags.
  idenaNode.nodeOptions = {
    dbWriteBufferMiB: writeBufferArgs.length > 0 ? options.dbWriteBufferMiB : 4,
    ipfsWriteBufferMiB:
      ipfsBufferArgs.length > 0 ? options.ipfsWriteBufferMiB : 4,
    peerLevel: peerArgs.length > 0 ? options.peerLevel : DEFAULT_PEER_LEVEL,
    ipfsConnections:
      peerArgs.length > 0
        ? ipfsConnectionsFor(options.ipfsConnections, options.peerLevel)
        : DEFAULT_IPFS_CONNECTIONS,
  }
  idenaNode.nodeOptionsSupported = {
    dbWriteBuffer: nodeSupportsWriteBuffer(help),
    ipfsWriteBuffer: nodeSupportsIpfsWriteBuffer(help),
    peerLimits: nodeSupportsPeerLimits(help),
  }

  idenaNode.on('exit', (code) => {
    if (useLogging) {
      console.info(`child process exited with code ${code}`)
    }
    if (onExit) {
      onExit(`node stopped with code ${code}`, code)
    }
  })

  return idenaNode
}

function getCurrentVersion(tempNode) {
  return getBinaryVersion(tempNode ? getTempNodeFile() : getNodeFile())
}

/**
 * Moves the new node (the temp file) over the installed one. Windows can keep the old binary locked for a moment
 * after its process exits, so a failed attempt is retried after a pause. Without a new node nothing is touched.
 */
async function updateNode({
  attempts = REPLACE_ATTEMPTS,
  retryDelayMs = REPLACE_RETRY_DELAY_MS,
} = {}) {
  const currentNode = getNodeFile()
  const tempNode = getTempNodeFile()
  if (!(await fs.pathExists(tempNode))) {
    throw new Error('no new idena-go file to install')
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      if (await fs.pathExists(currentNode)) {
        await fs.unlink(currentNode)
      }
      await fs.rename(tempNode, currentNode)
      break
    } catch (e) {
      if (attempt >= attempts) {
        throw new Error(`cannot replace the idena-go file: ${e.message}`)
      }
      logger.warn('cannot replace the idena-go file yet', {
        attempt,
        error: e.toString(),
      })
      await new Promise((resolve) => {
        setTimeout(resolve, retryDelayMs)
      })
    }
  }

  if (process.platform !== 'win32') {
    await fs.chmod(currentNode, '755')
  }
}

let installingBundledNode = null

/**
 * Installs the bundled node over another node in userData/node (main/bundled-node.js decides): the official
 * app's, or an older community build's. Call it while the node does not run. Resolves to whether it did.
 */
function installBundledNodeOverOther() {
  if (installingBundledNode) return installingBundledNode
  installingBundledNode = (async () => {
    const installed = getNodeFile()
    const bundled = await findBundledNodeFile()
    if (!bundled || !(await fs.pathExists(installed))) return false
    const [installedHash, bundledHash] = await Promise.all([
      sha256File(installed),
      sha256File(bundled),
    ])
    if (installedHash === bundledHash) return false
    const [installedVersion, bundledVersion] = await Promise.all([
      getBinaryVersion(installed).catch(() => undefined),
      getBinaryVersion(bundled).catch(() => undefined),
    ])
    if (
      !shouldReplaceInstalledNode({
        installedHash,
        bundledHash,
        installedVersion,
        bundledVersion,
      })
    ) {
      return false
    }
    if (!(await copyBundledNode(getTempNodeFile()))) return false
    await updateNode()
    logger.info('installed the bundled node over another one', {
      installedVersion,
      bundledVersion,
      installedHash,
      bundledHash,
    })
    return true
  })().finally(() => {
    installingBundledNode = null
  })
  return installingBundledNode
}

function nodeExists() {
  return fs.existsSync(getNodeFile())
}

function cleanNodeState() {
  const chainDbDirectory = getNodeChainDbFolder()
  if (fs.existsSync(chainDbDirectory)) {
    fs.removeSync(chainDbDirectory)
  }
}

function getLastLogs() {
  const number = 100
  return new Promise((resolve, reject) => {
    try {
      const logs = []
      lineReader.eachLine(getNodeLogsFile(), (line, last) => {
        logs.push(line)
        if (logs.length === number || last) {
          resolve(logs.reverse())
          return false
        }
        return true
      })
    } catch (e) {
      reject(e)
    }
  })
}

module.exports = {
  downloadNode,
  getCurrentVersion,
  getRemoteRelease,
  startNode,
  updateNode,
  nodeExists,
  cleanNodeState,
  installBundledNodeOverOther,
  getLastLogs,
  getNodeFile,
  getNodeChainDbFolder,
  getNodeIpfsDir,
}
