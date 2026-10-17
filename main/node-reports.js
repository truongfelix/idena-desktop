// Node reports, as in the phone app (idena-mobile NodeReports.kt): what the built-in node did when it stopped
// answering (main/node-watch.js), or when the user asked for one, in a text file the user can save from the
// Advanced settings and share.

const fs = require('fs')
const path = require('path')

/** The reports kept: the oldest goes. */
const KEPT_REPORTS = 5

/** How much of the end of the node's log a report holds. */
const REPORT_LOG_BYTES = 256 * 1024

/** The restarts by the app kept, for restartAllowed (main/node-watch.js). */
const KEPT_RESTARTS = 20

/** "node-report-2026-10-16-114410.txt", in UTC: the names sort by time. */
function reportName(at) {
  const stamp = new Date(at)
    .toISOString()
    .slice(0, 19)
    .replace('T', '-')
    .replace(/:/g, '')
  return `node-report-${stamp}.txt`
}

/** A report's text: what it is about, then the goroutines and the end of the node's log. */
function reportText({madeAt, app, why, stacks, stacksMissing, log}) {
  return [
    'Idena node report',
    `Made: ${new Date(madeAt).toISOString()}`,
    `App: ${app}`,
    `Why: ${why}`,
    '',
    '== Goroutines',
    stacks || stacksMissing,
    '',
    "== The node's log (output.log, its end; times in UTC)",
    log ?? 'Not read.',
    '',
  ].join('\n')
}

/** The last `bytes` of `file`, or null when it cannot be read. */
function readTail(file, bytes) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const {size} = fs.fstatSync(fd)
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * The reports in `dir()`, with the end of the node's log from `logFile()`; `app` names the app's version in
 * each report.
 */
function createNodeReports({dir, logFile, app}) {
  const reportsDir = () => {
    const folder = dir()
    fs.mkdirSync(folder, {recursive: true})
    return folder
  }
  const restartsFile = () => path.join(reportsDir(), 'watchdog-restarts')

  /** The reports' file names, the newest first. */
  function list() {
    try {
      return fs
        .readdirSync(reportsDir())
        .filter((name) => /^node-report-.*\.txt$/.test(name))
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  /** The newest report as {name, file, madeAt}, or null. */
  function latest() {
    const [name] = list()
    if (!name) return null
    const file = path.join(reportsDir(), name)
    try {
      return {name, file, madeAt: fs.statSync(file).mtimeMs}
    } catch {
      return null
    }
  }

  /** When the app restarted the node (wall clock, ms), the oldest first. */
  function restarts() {
    try {
      return fs
        .readFileSync(restartsFile(), 'utf8')
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((at) => Number.isFinite(at) && at > 0)
    } catch {
      return []
    }
  }

  function recordRestart(at) {
    const kept = [...restarts(), at].slice(-KEPT_RESTARTS)
    fs.writeFileSync(restartsFile(), `${kept.join('\n')}\n`)
  }

  /** Writes a report on `why`, with the node's `stacks` (or why there are none); returns its file. */
  function write({why, stacks, stacksMissing, now = Date.now()}) {
    const file = path.join(reportsDir(), reportName(now))
    fs.writeFileSync(
      file,
      reportText({
        madeAt: now,
        app,
        why,
        stacks,
        stacksMissing,
        log: readTail(logFile(), REPORT_LOG_BYTES),
      })
    )
    for (const old of list().slice(KEPT_REPORTS)) {
      fs.rmSync(path.join(reportsDir(), old), {force: true})
    }
    return file
  }

  return {list, latest, restarts, recordRestart, write}
}

module.exports = {
  KEPT_REPORTS,
  REPORT_LOG_BYTES,
  createNodeReports,
  reportName,
  reportText,
}
