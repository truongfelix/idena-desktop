const fs = require('fs')
const path = require('path')
const {
  checkGlibcFloor,
  compareVersions,
  requiredGlibcVersions,
} = require('./check-node-glibc')

// `readelf -V --wide` output from its "Version needs" line on: the node built on a glibc 2.43 host (pidfd_spawnp and
// pidfd_getpid from the wasm binding link to GLIBC_2.39) and the official node 1.1.2.
function readelfOutput(name) {
  return fs.readFileSync(path.join(__dirname, 'testdata', name), 'utf8')
}
const hostBuild = readelfOutput('readelf-version-needs-glibc-2.39.txt')
const officialBuild = readelfOutput('readelf-version-needs-glibc-2.29.txt')

describe('node glibc check', () => {
  it('compares glibc versions by number', () => {
    expect(compareVersions('2.39', '2.35')).toBeGreaterThan(0)
    expect(compareVersions('2.3.4', '2.3')).toBeGreaterThan(0)
    expect(compareVersions('2.10', '2.9')).toBeGreaterThan(0)
    expect(compareVersions('2.35', '2.35')).toBe(0)
  })

  it('reads every required glibc version, oldest first', () => {
    const versions = requiredGlibcVersions(hostBuild)
    expect(versions[0]).toBe('2.2.5')
    expect(versions.slice(-3)).toEqual(['2.33', '2.34', '2.39'])
  })

  it('refuses a node that needs glibc 2.39', () => {
    expect(checkGlibcFloor(hostBuild)).toEqual({
      newest: '2.39',
      tooNew: ['2.39'],
    })
  })

  it('accepts the official node, which needs glibc 2.29', () => {
    expect(checkGlibcFloor(officialBuild)).toEqual({
      newest: '2.29',
      tooNew: [],
    })
  })

  it('ignores a need the loader only warns about (WEAK)', () => {
    const weak = hostBuild.replace(
      /(Name: GLIBC_2\.39\s+Flags: )none/u,
      '$1WEAK'
    )
    expect(weak).not.toBe(hostBuild)
    expect(checkGlibcFloor(weak)).toEqual({newest: '2.34', tooNew: []})
  })

  it('takes another limit', () => {
    expect(checkGlibcFloor(hostBuild, '2.39').tooNew).toEqual([])
    expect(checkGlibcFloor(officialBuild, '2.28').tooNew).toEqual(['2.29'])
  })

  it('fails when the output holds no version needs', () => {
    expect(() => checkGlibcFloor('readelf: Error: Not an ELF file')).toThrow(
      'no glibc version needs'
    )
  })
})
