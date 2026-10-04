const crypto = require('crypto')
const semver = require('semver')
const {
  assertSafeNodeDownloadUrl,
  parseNodeChecksum,
} = require('./node-download-safety')

// A node release that changes the consensus rules carries a description of the hard fork as a release asset,
// next to the binaries and checked the same way (hardfork.json + hardfork.json.sha256). Without it, a release
// is an ordinary update, whatever its version number. Format:
// {"version": "1.2.0", "upgrade": 13, "changes": ["..."],
//  "startActivationDate": "2027-01-10T08:00:00Z", "endActivationDate": "2027-01-20T00:00:00Z",
//  "activated": false}
// "activated" is set by a later upload once the network switched: a node on the old rules stops at the
// upgrade block and cannot tell.
const HARD_FORK_INFO_ASSET = 'hardfork.json'
const MAX_HARD_FORK_INFO_SIZE = 64 * 1024
const MAX_CHANGES = 100
const MAX_CHANGE_LENGTH = 1000

function parseDate(value, name) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  if (Number.isNaN(time)) {
    throw new Error(`Invalid hard fork ${name}`)
  }
  return new Date(time).toISOString()
}

function parseHardForkInfo(text, releaseVersion) {
  const info = JSON.parse(text)
  if (!info || typeof info !== 'object' || Array.isArray(info)) {
    throw new Error('Invalid hard fork description')
  }

  const version = semver.valid(info.version)
  if (!version || version !== semver.valid(releaseVersion)) {
    throw new Error('Hard fork description is for another node version')
  }

  if (!Number.isInteger(info.upgrade) || info.upgrade < 1) {
    throw new Error('Invalid hard fork upgrade number')
  }

  if (
    !Array.isArray(info.changes) ||
    info.changes.length > MAX_CHANGES ||
    info.changes.some(
      (change) =>
        typeof change !== 'string' ||
        !change.trim() ||
        change.length > MAX_CHANGE_LENGTH
    )
  ) {
    throw new Error('Invalid hard fork changes')
  }

  const startActivationDate = parseDate(
    info.startActivationDate,
    'activation start'
  )
  const endActivationDate = parseDate(info.endActivationDate, 'activation end')
  if (Date.parse(startActivationDate) >= Date.parse(endActivationDate)) {
    throw new Error('Hard fork activation ends before it starts')
  }

  if (info.activated !== undefined && typeof info.activated !== 'boolean') {
    throw new Error('Invalid hard fork activation flag')
  }

  return {
    version,
    upgrade: info.upgrade,
    changes: info.changes.map((change) => change.trim()),
    startActivationDate,
    endActivationDate,
    activated: info.activated === true,
  }
}

// assets: the release's assets from the GitHub API; get: axios.get. Returns null when the release declares no
// hard fork, and throws when it declares one that cannot be verified.
async function fetchHardForkInfo({assets, version, get}) {
  const asset = assets.find(({name}) => name === HARD_FORK_INFO_ASSET)
  if (!asset) {
    return null
  }

  const checksumAsset = assets.find(
    ({name}) => name === `${HARD_FORK_INFO_ASSET}.sha256`
  )
  if (!checksumAsset) {
    throw new Error('Hard fork description has no checksum')
  }

  const {data: checksumData} = await get(
    assertSafeNodeDownloadUrl(checksumAsset.browser_download_url),
    {responseType: 'text', maxContentLength: 4096, maxBodyLength: 4096}
  )
  const expectedSha256 = parseNodeChecksum(
    String(checksumData),
    HARD_FORK_INFO_ASSET
  )

  const {data} = await get(
    assertSafeNodeDownloadUrl(asset.browser_download_url),
    {
      responseType: 'arraybuffer',
      maxContentLength: MAX_HARD_FORK_INFO_SIZE,
      maxBodyLength: MAX_HARD_FORK_INFO_SIZE,
    }
  )
  const body = Buffer.from(data)
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  if (sha256 !== expectedSha256) {
    throw new Error('Hard fork description does not match its checksum')
  }

  return parseHardForkInfo(body.toString('utf8'), version)
}

module.exports = {
  HARD_FORK_INFO_ASSET,
  fetchHardForkInfo,
  parseHardForkInfo,
}
