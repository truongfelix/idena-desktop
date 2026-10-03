// When the app's bundled node replaces the node already installed in userData/node. The official app uses the
// same userData folder ("Idena") and every build reports version 1.1.2, so without this a user coming from it
// (or from an older community build) keeps that node forever: the bundled node is otherwise copied only when
// none is installed, and the updater compares versions only.

const crypto = require('crypto')
const fs = require('fs')
const semver = require('semver')

/**
 * Whether to install the bundled node over the installed one: when their contents differ and the installed
 * version is not newer (a node update from our releases is kept until the app bundles a newer one).
 */
function shouldReplaceInstalledNode({
  installedHash,
  bundledHash,
  installedVersion,
  bundledVersion,
}) {
  if (!installedHash || !bundledHash || installedHash === bundledHash) {
    return false
  }
  if (!semver.valid(bundledVersion)) return false
  if (!semver.valid(installedVersion)) return true
  return semver.lte(installedVersion, bundledVersion)
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

module.exports = {shouldReplaceInstalledNode, sha256File}
