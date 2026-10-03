const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {shouldReplaceInstalledNode, sha256File} = require('./bundled-node')

const ours = {bundledHash: 'aa', bundledVersion: '1.1.2'}

describe('bundled node', () => {
  it('replaces another build of the same version', () => {
    expect(
      shouldReplaceInstalledNode({
        ...ours,
        installedHash: 'bb',
        installedVersion: '1.1.2',
      })
    ).toBe(true)
  })

  it('replaces an older node or one without a readable version', () => {
    expect(
      shouldReplaceInstalledNode({
        ...ours,
        installedHash: 'bb',
        installedVersion: '1.0.9',
      })
    ).toBe(true)
    expect(
      shouldReplaceInstalledNode({
        ...ours,
        installedHash: 'bb',
        installedVersion: undefined,
      })
    ).toBe(true)
  })

  it('keeps the same binary and a newer node', () => {
    expect(
      shouldReplaceInstalledNode({
        ...ours,
        installedHash: 'aa',
        installedVersion: '1.1.2',
      })
    ).toBe(false)
    expect(
      shouldReplaceInstalledNode({
        ...ours,
        installedHash: 'bb',
        installedVersion: '1.2.0',
      })
    ).toBe(false)
  })

  it('does nothing without both binaries or a bundled version', () => {
    expect(
      shouldReplaceInstalledNode({
        ...ours,
        installedHash: undefined,
        installedVersion: '1.1.2',
      })
    ).toBe(false)
    expect(
      shouldReplaceInstalledNode({
        installedHash: 'bb',
        installedVersion: '1.1.2',
        bundledHash: undefined,
        bundledVersion: '1.1.2',
      })
    ).toBe(false)
    expect(
      shouldReplaceInstalledNode({
        installedHash: 'bb',
        installedVersion: '1.1.2',
        bundledHash: 'aa',
        bundledVersion: undefined,
      })
    ).toBe(false)
  })

  it('hashes a file', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'node-')), 'x')
    fs.writeFileSync(file, 'idena')
    expect(await sha256File(file)).toBe(
      crypto.createHash('sha256').update('idena').digest('hex')
    )
  })
})
