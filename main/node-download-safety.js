const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const semver = require('semver')

const MIN_NODE_BINARY_SIZE = 1024 * 1024
const NODE_RELEASE_PATH_PREFIX = '/truongfelix/idena-go/releases/download/'

function isSafeNodeDownloadUrl(value) {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const parsedUrl = new URL(value)

    return (
      parsedUrl.protocol === 'https:' &&
      parsedUrl.username === '' &&
      parsedUrl.password === '' &&
      parsedUrl.hostname === 'github.com' &&
      parsedUrl.pathname.startsWith(NODE_RELEASE_PATH_PREFIX)
    )
  } catch {
    return false
  }
}

function parseNodeChecksum(value, expectedFileName) {
  if (typeof value !== 'string' || !expectedFileName) {
    throw new Error('Invalid Idena node checksum response')
  }

  const line = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find(Boolean)
  const match = line?.match(/^([0-9a-f]{64})\s+\*?(.+)$/iu)
  if (!match || path.basename(match[2]) !== expectedFileName) {
    throw new Error('Invalid Idena node checksum response')
  }

  return match[1].toLowerCase()
}

function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const input = fs.createReadStream(filePath)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

function assertSafeNodeDownloadUrl(value) {
  if (!isSafeNodeDownloadUrl(value)) {
    throw new Error('Unsafe Idena node download URL')
  }

  return new URL(value).href
}

async function validateDownloadedNode({
  filePath,
  expectedVersion,
  expectedSha256,
  getBinaryVersion,
  stat,
  chmod,
  calculateSha256 = calculateFileSha256,
  platform = process.platform,
}) {
  const normalizedExpectedVersion = semver.clean(expectedVersion)
  if (!normalizedExpectedVersion) {
    throw new Error(`Invalid expected Idena node version: ${expectedVersion}`)
  }

  if (platform !== 'win32') {
    await chmod(filePath, 0o755)
  }

  const stats = await stat(filePath)
  if (!stats || stats.size < MIN_NODE_BINARY_SIZE) {
    throw new Error('Downloaded Idena node binary is unexpectedly small')
  }

  if (!/^[0-9a-f]{64}$/u.test(expectedSha256 || '')) {
    throw new Error('Invalid expected Idena node checksum')
  }
  const actualSha256 = await calculateSha256(filePath)
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error('Downloaded Idena node checksum mismatch')
  }

  const actualVersion = await getBinaryVersion(filePath)
  if (actualVersion !== normalizedExpectedVersion) {
    throw new Error(
      `Downloaded Idena node version mismatch: expected ${normalizedExpectedVersion}, got ${actualVersion}`
    )
  }

  return actualVersion
}

module.exports = {
  MIN_NODE_BINARY_SIZE,
  assertSafeNodeDownloadUrl,
  calculateFileSha256,
  isSafeNodeDownloadUrl,
  parseNodeChecksum,
  validateDownloadedNode,
}
