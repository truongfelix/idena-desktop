const {createNodeWatchdog} = require('./node-watchdog')
const {READ_INTERVAL_MS} = require('./node-watch')

const MIN = 60 * 1000

function setup({
  restarts = [],
  answers = () => true,
  stacks = 'goroutine 1',
} = {}) {
  let clock = 0
  const written = []
  const recorded = []
  const nodeProcess = {
    current: {pid: 1},
    quit: jest.fn(async () => {
      nodeProcess.current = null
      return {log: 'node 1 stopped', stacks}
    }),
  }
  const reports = {
    restarts: () => [...restarts, ...recorded],
    recordRestart: (at) => recorded.push(at),
    write: jest.fn((report) => {
      written.push(report)
      return `/reports/${written.length}`
    }),
  }
  const onRestart = jest.fn()
  const watchdog = createNodeWatchdog({
    nodeProcess,
    nodeAnswers: jest.fn(async () => {
      if (!answers(clock)) throw new Error('connect ECONNREFUSED')
      return {syncing: false}
    }),
    reports,
    onRestart,
    logger: {info: jest.fn(), warn: jest.fn(), error: jest.fn()},
    now: () => clock,
    wallNow: () => 1e12 + clock,
  })
  const runFor = async (ms) => {
    const end = clock + ms
    while (clock < end) {
      clock += READ_INTERVAL_MS
      // eslint-disable-next-line no-await-in-loop
      await watchdog.read()
    }
  }
  return {watchdog, nodeProcess, written, recorded, onRestart, runFor}
}

describe('the node watchdog', () => {
  it('restarts a node silent for 5 min, with a report holding its goroutines', async () => {
    const {watchdog, nodeProcess, written, recorded, onRestart, runFor} = setup(
      {
        answers: (t) => t < 10 * MIN,
      }
    )
    watchdog.started()
    await runFor(14 * MIN)
    expect(onRestart).not.toHaveBeenCalled()
    await runFor(2 * MIN)
    expect(nodeProcess.quit).toHaveBeenCalledTimes(1)
    expect(onRestart).toHaveBeenCalledTimes(1)
    expect(recorded).toHaveLength(1)
    expect(written).toHaveLength(1)
    expect(written[0].why).toBe(
      'The node had not answered for 5 min. The app restarted it.'
    )
    expect(written[0].stacks).toBe('goroutine 1')
  })

  it('leaves a node that answers', async () => {
    const {watchdog, onRestart, written, runFor} = setup()
    watchdog.started()
    await runFor(60 * MIN)
    expect(onRestart).not.toHaveBeenCalled()
    expect(written).toEqual([])
  })

  it('does not restart after 3 restarts in 6 hours, and reports once', async () => {
    const {watchdog, nodeProcess, onRestart, written, runFor} = setup({
      restarts: [1e12 - 60 * MIN, 1e12 - 120 * MIN, 1e12 - 180 * MIN],
      answers: () => false,
    })
    watchdog.started()
    await runFor(60 * MIN)
    expect(nodeProcess.quit).not.toHaveBeenCalled()
    expect(onRestart).not.toHaveBeenCalled()
    expect(written).toHaveLength(1)
    expect(written[0].why).toContain(
      'The app did not restart it: it had restarted it 3 times in 6 h.'
    )
  })

  it('waits for a node compacting its database', async () => {
    const {watchdog, onRestart, runFor} = setup({answers: (t) => t > 25 * MIN})
    watchdog.started()
    watchdog.logged(['INFO [10-16|10:00:00.000] Start compacting DB'])
    await runFor(24 * MIN)
    watchdog.logged(['INFO [10-16|10:22:00.000] DB compacted'])
    await runFor(30 * MIN)
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('reads nothing while no node runs', async () => {
    const {watchdog, nodeProcess, onRestart, runFor} = setup({
      answers: () => false,
    })
    watchdog.started()
    nodeProcess.current = null
    await runFor(60 * MIN)
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('makes a report by hand only from a running node', () => {
    const {watchdog, nodeProcess, written} = setup()
    expect(watchdog.makeReport()).toBe('/reports/1')
    expect(written[0].why).toBe('Made by the user in the Advanced settings.')
    expect(written[0].stacks).toBeUndefined()
    nodeProcess.current = null
    expect(() => watchdog.makeReport()).toThrow('the node does not run')
  })
})
