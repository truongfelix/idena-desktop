#!/usr/bin/env node

// Refuses a Linux node binary that needs a newer glibc than the oldest systems the release supports (Ubuntu 22.04,
// glibc 2.35; Debian 12 has 2.36). The loader refuses to start a binary when one of its required glibc versions is
// missing ("version `GLIBC_2.39' not found"), so the newest version the binary requires is the floor.
// Usage: node scripts/check-node-glibc.js <binary> [max version]

const {spawnSync} = require('child_process')

const DEFAULT_MAX_GLIBC = '2.35'

function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

// The glibc versions in `readelf -V` "Version needs" entries without the WEAK flag (a weak need only warns).
function requiredGlibcVersions(readelfOutput) {
  const section = readelfOutput.split(/Version needs section/u)[1] || ''
  const versions = new Set()
  for (const match of section.matchAll(
    /Name: GLIBC_([0-9][0-9.]*)\s+Flags: ([^\n]*?)\s+Version:/gu
  )) {
    if (!/\bWEAK\b/u.test(match[2])) versions.add(match[1])
  }
  return [...versions].sort(compareVersions)
}

function checkGlibcFloor(readelfOutput, maxVersion = DEFAULT_MAX_GLIBC) {
  const versions = requiredGlibcVersions(readelfOutput)
  if (versions.length === 0) {
    throw new Error('no glibc version needs found in the readelf output')
  }
  const newest = versions[versions.length - 1]
  const tooNew = versions.filter((v) => compareVersions(v, maxVersion) > 0)
  return {newest, tooNew}
}

function main() {
  const [binary, maxVersion = DEFAULT_MAX_GLIBC] = process.argv.slice(2)
  if (!binary) {
    console.error('usage: check-node-glibc.js <binary> [max version]')
    process.exit(2)
  }
  // -V also lists the version of every dynamic symbol: ~4.6 MB for the node.
  const result = spawnSync('readelf', ['-V', '--wide', binary], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    console.error(
      `readelf failed on ${binary}: ${
        result.error ? result.error.message : result.stderr
      }`
    )
    process.exit(2)
  }
  const {newest, tooNew} = checkGlibcFloor(result.stdout, maxVersion)
  if (tooNew.length > 0) {
    console.error(
      `${binary} requires GLIBC_${tooNew.join(
        ', GLIBC_'
      )}: newer than ${maxVersion}, so it does not start on older systems`
    )
    process.exit(1)
  }
  console.log(
    `${binary} requires at most GLIBC_${newest} (limit ${maxVersion})`
  )
}

if (require.main === module) {
  main()
}

module.exports = {
  DEFAULT_MAX_GLIBC,
  checkGlibcFloor,
  compareVersions,
  requiredGlibcVersions,
}
