const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  advisoriesOf,
  evaluateAudit,
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
    expect(exceptions.map(({package: name}) => name)).toEqual([
      'braces',
      'http-cache-semantics',
    ])
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
  })
})
