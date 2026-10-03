#!/usr/bin/env node

// `npm audit --audit-level=moderate`, with dated exceptions for advisories that have no fixed version yet
// (scripts/npm-audit-exceptions.json). An exception holds only while it has not expired and the latest
// published version of its package is still in the advisory's vulnerable range: once a fix ships, or at
// the expiry date, the audit fails again. Every other advisory fails as before.

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')
const semver = require('semver')

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const EXCEPTIONS_FILE = path.join(__dirname, 'npm-audit-exceptions.json')
const FAILING_SEVERITIES = new Set(['moderate', 'high', 'critical'])

/** The advisories of an `npm audit --json` report (v2) at moderate severity or above. */
function advisoriesOf(report) {
  const byId = new Map()
  for (const entry of Object.values(report.vulnerabilities || {})) {
    // A string in `via` names the dependency that brings an advisory, listed under that dependency.
    const advisories = (entry.via || []).filter(
      (via) => typeof via === 'object' && FAILING_SEVERITIES.has(via.severity)
    )
    for (const via of advisories) {
      const id = String(via.url || via.source)
        .split('/')
        .pop()
      byId.set(id, {
        id,
        package: via.name,
        range: via.range,
        severity: via.severity,
        title: via.title,
      })
    }
  }
  return [...byId.values()]
}

/**
 * Splits the advisories of `report` into allowed (a valid exception) and failures, and lists the
 * exceptions no advisory needs any more. `latestVersion(name)` gives a package's latest published version.
 */
function evaluateAudit(report, exceptions, today, latestVersion) {
  const allowed = []
  const failures = []
  const advisories = advisoriesOf(report)
  for (const advisory of advisories) {
    const exception = exceptions.find(({id}) => id === advisory.id)
    if (!exception) {
      failures.push({advisory, reason: 'no exception'})
    } else if (exception.package !== advisory.package) {
      failures.push({advisory, reason: `exception names ${exception.package}`})
    } else if (today > exception.expires) {
      failures.push({
        advisory,
        reason: `exception expired ${exception.expires}`,
      })
    } else {
      const latest = latestVersion(advisory.package)
      if (!latest || !semver.satisfies(latest, advisory.range)) {
        failures.push({
          advisory,
          reason: latest
            ? `${advisory.package}@${latest} is outside ${advisory.range}: update to the fixed version`
            : `cannot read the latest version of ${advisory.package}`,
        })
      } else {
        allowed.push({advisory, exception})
      }
    }
  }
  const stale = exceptions.filter(
    ({id}) => !advisories.some((advisory) => advisory.id === id)
  )
  return {allowed, failures, stale}
}

function readExceptions(file = EXCEPTIONS_FILE) {
  const exceptions = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const exception of exceptions) {
    if (
      !/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/u.test(exception.id) ||
      !exception.package ||
      !exception.reason ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(exception.expires)
    ) {
      throw new Error(
        `invalid npm audit exception: ${JSON.stringify(exception)}`
      )
    }
  }
  return exceptions
}

function npmLatestVersion(name) {
  const result = spawnSync(npmCommand, ['view', name, 'version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return result.status === 0 ? result.stdout.trim() : null
}

function main() {
  const exceptions = readExceptions()
  const audit = spawnSync(npmCommand, ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  let report
  try {
    report = JSON.parse(audit.stdout)
  } catch {
    console.error(audit.stderr || audit.stdout)
    console.error('[npm-audit] could not read the npm audit report')
    process.exit(1)
  }
  if (report.error) {
    console.error(
      `[npm-audit] npm audit failed: ${JSON.stringify(report.error)}`
    )
    process.exit(1)
  }
  const today = new Date().toISOString().slice(0, 10)
  const {allowed, failures, stale} = evaluateAudit(
    report,
    exceptions,
    today,
    npmLatestVersion
  )
  for (const {advisory, exception} of allowed) {
    console.log(
      `[npm-audit] allowed until ${exception.expires}: ${advisory.id} ${advisory.package} ${advisory.range} (${advisory.severity}): ${exception.reason}`
    )
  }
  for (const exception of stale) {
    console.log(
      `[npm-audit] exception no longer needed, remove it: ${exception.id} ${exception.package}`
    )
  }
  for (const {advisory, reason} of failures) {
    console.error(
      `[npm-audit] ${advisory.id} ${advisory.package} ${advisory.range} (${advisory.severity}) ${advisory.title}: ${reason}`
    )
  }
  if (failures.length > 0) process.exit(1)
  console.log(`[npm-audit] passed (${allowed.length} allowed by exception)`)
}

if (require.main === module) main()

module.exports = {advisoriesOf, evaluateAudit, readExceptions}
