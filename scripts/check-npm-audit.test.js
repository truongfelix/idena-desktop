const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  advisoriesOf,
  evaluateAudit,
  latestInMajor,
  readExceptions,
} = require('./check-npm-audit')

const braces = {
  source: 1240992,
  name: 'braces',
  title: 'braces vulnerable to stack-exhaustion denial of service',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  severity: 'high',
  range: '<=3.0.3',
}

const report = (...vias) => ({
  auditReportVersion: 2,
  vulnerabilities: {
    braces: {name: 'braces', via: vias},
    micromatch: {name: 'micromatch', via: ['braces']},
  },
})

const exception = {
  id: 'GHSA-vfj7-8cjw-p6xm',
  package: 'braces',
  reason: 'no fixed version',
  expires: '2026-11-02',
}

const unpatched = () => '3.0.3'

describe('npm audit with dated exceptions', () => {
  it('reads the advisories at moderate severity and above', () => {
    const low = {
      ...braces,
      url: 'https://github.com/advisories/GHSA-low',
      severity: 'low',
    }
    expect(advisoriesOf(report(braces, low))).toEqual([
      {
        id: 'GHSA-vfj7-8cjw-p6xm',
        package: 'braces',
        range: '<=3.0.3',
        severity: 'high',
        title: braces.title,
      },
    ])
  })

  it('fails an advisory without an exception', () => {
    const {allowed, failures} = evaluateAudit(
      report(braces),
      [],
      '2026-10-03',
      unpatched
    )
    expect(allowed).toEqual([])
    expect(failures.map(({reason}) => reason)).toEqual(['no exception'])
  })

  it('allows an advisory with a valid exception while no fix exists', () => {
    const {allowed, failures, stale} = evaluateAudit(
      report(braces),
      [exception],
      '2026-11-02',
      unpatched
    )
    expect(allowed).toHaveLength(1)
    expect(failures).toEqual([])
    expect(stale).toEqual([])
  })

  it('fails once the exception has expired', () => {
    const {failures} = evaluateAudit(
      report(braces),
      [exception],
      '2026-11-03',
      unpatched
    )
    expect(failures.map(({reason}) => reason)).toEqual([
      'exception expired 2026-11-02',
    ])
  })

  it('fails once a fixed version is published', () => {
    const {failures} = evaluateAudit(
      report(braces),
      [exception],
      '2026-10-03',
      () => '3.0.4'
    )
    expect(failures[0].reason).toMatch('braces@3.0.4 is outside <=3.0.3')
  })

  it('fails when the latest version cannot be read', () => {
    const {failures} = evaluateAudit(
      report(braces),
      [exception],
      '2026-10-03',
      () => null
    )
    expect(failures[0].reason).toMatch('cannot read the latest version')
  })

  it('fails when the exception names another package', () => {
    const {failures} = evaluateAudit(
      report(braces),
      [{...exception, package: 'micromatch'}],
      '2026-10-03',
      unpatched
    )
    expect(failures[0].reason).toBe('exception names micromatch')
  })

  it('lists the exceptions no advisory needs', () => {
    const {stale, failures} = evaluateAudit(
      report(),
      [exception],
      '2026-10-03',
      unpatched
    )
    expect(stale).toEqual([exception])
    expect(failures).toEqual([])
  })

  it('reads the committed exceptions', () => {
    const exceptions = readExceptions(
      path.join(__dirname, 'npm-audit-exceptions.json')
    )
    expect(exceptions.map(({package: name}) => name)).toEqual(['minimatch'])
  })

  it('rejects an exception without a reason or a date', () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'audit-')),
      'x.json'
    )
    fs.writeFileSync(file, JSON.stringify([{...exception, expires: 'soon'}]))
    expect(() => readExceptions(file)).toThrow('invalid npm audit exception')
    fs.writeFileSync(file, JSON.stringify([{...exception, reason: ''}]))
    expect(() => readExceptions(file)).toThrow('invalid npm audit exception')
    fs.writeFileSync(file, JSON.stringify([{...exception, major: '3'}]))
    expect(() => readExceptions(file)).toThrow('invalid npm audit exception')
  })
})

describe('an exception bound to a major version', () => {
  const minimatch = {
    source: 1,
    name: 'minimatch',
    title: 'minimatch has potential denial of service',
    url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
    severity: 'moderate',
    range: '<11.0.1',
  }
  const minimatchReport = {
    auditReportVersion: 2,
    vulnerabilities: {minimatch: {name: 'minimatch', via: [minimatch]}},
  }
  const bound = {
    id: 'GHSA-g3hv-75wg-m249',
    package: 'minimatch',
    major: 3,
    reason: 'fixed only in 11',
    expires: '2026-12-02',
  }
  // The registry: 11.0.3 is fixed, the newest 3.x is not; `fixed3` adds a fixed 3.x.
  const published = ['3.1.5', '10.2.6', '11.0.3']
  const registry = (versions) => (name, major) =>
    major === undefined ? '11.0.3' : latestInMajor(versions, major)

  it('holds while the newest version of that major is still vulnerable', () => {
    const {allowed, failures} = evaluateAudit(
      minimatchReport,
      [bound],
      '2026-10-31',
      registry(published)
    )
    expect(failures).toEqual([])
    expect(allowed).toHaveLength(1)
  })

  it('without the major, a fix in a later major ends it', () => {
    const {major, ...plain} = bound
    const {failures} = evaluateAudit(
      minimatchReport,
      [plain],
      '2026-10-31',
      registry(published)
    )
    expect(failures.map(({reason}) => reason)).toEqual([
      'minimatch@11.0.3 is outside <11.0.1: update to the fixed version',
    ])
  })

  it('a fixed version within that major ends it', () => {
    // The advisory's range once a 3.x fix ships, as GitHub would widen it.
    const widened = {
      ...minimatchReport,
      vulnerabilities: {
        minimatch: {
          name: 'minimatch',
          via: [{...minimatch, range: '<3.1.6 || >=4.0.0 <11.0.1'}],
        },
      },
    }
    const {failures} = evaluateAudit(
      widened,
      [bound],
      '2026-10-31',
      registry([...published, '3.1.6'])
    )
    expect(failures.map(({reason}) => reason)).toEqual([
      'minimatch@3.1.6 is outside <3.1.6 || >=4.0.0 <11.0.1: update to the fixed version',
    ])
  })

  it('still ends at its date', () => {
    const {failures} = evaluateAudit(
      minimatchReport,
      [bound],
      '2026-12-03',
      registry(published)
    )
    expect(failures.map(({reason}) => reason)).toEqual([
      'exception expired 2026-12-02',
    ])
  })

  it('picks the newest stable version of a major', () => {
    expect(latestInMajor(['3.0.4', '3.1.5', '3.2.0-rc.1', '4.0.0'], 3)).toBe(
      '3.1.5'
    )
    expect(latestInMajor(['4.0.0'], 3)).toBeNull()
  })
})
