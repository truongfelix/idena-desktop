const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  KEPT_REPORTS,
  REPORT_LOG_BYTES,
  createNodeReports,
  reportName,
} = require('./node-reports')

let dir
let logFile

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-reports-'))
  logFile = path.join(dir, 'output.log')
})

afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

const reports = () =>
  createNodeReports({
    dir: () => path.join(dir, 'reports'),
    logFile: () => logFile,
    app: '0.40.0',
  })

describe('node reports', () => {
  it('are named by their UTC time', () => {
    expect(reportName(Date.UTC(2026, 9, 16, 11, 44, 10))).toBe(
      'node-report-2026-10-16-114410.txt'
    )
  })

  it('hold the reason, the goroutines and the end of the log', () => {
    fs.writeFileSync(logFile, `${'x'.repeat(REPORT_LOG_BYTES)}LAST LINE\n`)
    const file = reports().write({
      why: 'The node had not answered for 5 min.',
      stacks: 'goroutine 1 [select]:',
      now: Date.UTC(2026, 9, 16, 11, 44, 10),
    })
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('Made: 2026-10-16T11:44:10.000Z')
    expect(text).toContain('App: 0.40.0')
    expect(text).toContain('Why: The node had not answered for 5 min.')
    expect(text).toContain('== Goroutines\ngoroutine 1 [select]:')
    expect(text).toContain('LAST LINE')
    expect(text.length).toBeLessThan(REPORT_LOG_BYTES + 1000)
  })

  it('say why there are no goroutines, and when the log is missing', () => {
    const file = reports().write({
      why: 'Asked for by the user.',
      stacksMissing: 'Not taken: the node runs on.',
      now: 1,
    })
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('== Goroutines\nNot taken: the node runs on.')
    expect(text).toContain('Not read.')
  })

  it('keep the newest 5', () => {
    const r = reports()
    for (let i = 0; i < KEPT_REPORTS + 2; i += 1) {
      r.write({why: `report ${i}`, stacksMissing: '-', now: (i + 1) * 1000})
    }
    expect(r.list()).toHaveLength(KEPT_REPORTS)
    expect(r.list()[0]).toBe(reportName((KEPT_REPORTS + 2) * 1000))
    expect(fs.readFileSync(r.latest().file, 'utf8')).toContain(
      `report ${KEPT_REPORTS + 1}`
    )
  })

  it('have no latest before the first', () => {
    expect(reports().latest()).toBeNull()
    expect(reports().restarts()).toEqual([])
  })

  it('keep the restarts by the app', () => {
    const r = reports()
    r.recordRestart(1000)
    r.recordRestart(2000)
    expect(reports().restarts()).toEqual([1000, 2000])
    for (let i = 0; i < 30; i += 1) r.recordRestart(3000 + i)
    expect(r.restarts()).toHaveLength(20)
    expect(r.restarts()[19]).toBe(3029)
  })
})
