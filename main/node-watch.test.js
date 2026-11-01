const {
  FROZEN_AFTER_ANSWER_MS,
  FROZEN_WITHOUT_ANSWER_MS,
  MIN_FAILED_READS,
  RESTART_WINDOW_MS,
  createNodeWatch,
  restartAllowed,
} = require('./node-watch')

const MIN = 60 * 1000

function failReads(watch, from, count, every = 15 * 1000) {
  for (let i = 1; i <= count; i += 1) watch.failed(from + i * every)
}

describe('the node watch', () => {
  it('stops a node silent for 5 min after an answer', () => {
    const watch = createNodeWatch(0)
    watch.answered(1000)
    failReads(watch, 1000, 20)
    expect(watch.frozen(1000 + FROZEN_AFTER_ANSWER_MS - 1)).toBe(false)
    expect(watch.frozen(1000 + FROZEN_AFTER_ANSWER_MS)).toBe(true)
    expect(watch.silentFor(1000 + 6 * MIN)).toBe(6 * MIN)
  })

  it('gives a node that never answered 15 min', () => {
    const watch = createNodeWatch(0)
    failReads(watch, 0, 60)
    expect(watch.frozen(10 * MIN)).toBe(false)
    expect(watch.frozen(FROZEN_WITHOUT_ANSWER_MS)).toBe(true)
  })

  it('needs reads in a row without an answer', () => {
    const watch = createNodeWatch(0)
    watch.answered(0)
    // The computer slept: the clock went on, but only one read failed since.
    watch.failed(10 * MIN)
    expect(watch.frozen(10 * MIN)).toBe(false)
    failReads(watch, 10 * MIN, MIN_FAILED_READS - 2)
    expect(watch.frozen(12 * MIN)).toBe(false)
    watch.failed(12 * MIN)
    expect(watch.frozen(12 * MIN)).toBe(true)
  })

  it('starts counting again on an answer', () => {
    const watch = createNodeWatch(0)
    failReads(watch, 0, 7)
    watch.answered(2 * MIN)
    failReads(watch, 2 * MIN, 7)
    expect(watch.frozen(30 * MIN)).toBe(false)
  })

  it('counts the database compaction as the start', () => {
    const watch = createNodeWatch(0)
    watch.logged(['INFO [10-16|10:00:00.000] Start compacting DB'])
    failReads(watch, 0, 100)
    expect(watch.frozen(25 * MIN)).toBe(false)
    watch.logged(['INFO [10-16|10:22:00.000] DB compacted d=21m47s'])
    failReads(watch, 25 * MIN, 19)
    expect(watch.frozen(25 * MIN + FROZEN_AFTER_ANSWER_MS - 1)).toBe(false)
    expect(watch.frozen(25 * MIN + FROZEN_AFTER_ANSWER_MS)).toBe(true)
  })

  it('counts the conversion of an IPFS repository from Badger as the start', () => {
    const watch = createNodeWatch(0)
    watch.logged([
      'INFO [10-31|10:00:00.000] Start converting the IPFS repository     attempt=1',
    ])
    failReads(watch, 0, 200)
    expect(watch.frozen(50 * MIN)).toBe(false)
    watch.logged([
      'INFO [10-31|10:48:00.000] IPFS repository conversion ended         converted=true keys=412345',
    ])
    failReads(watch, 50 * MIN, 19)
    expect(watch.frozen(50 * MIN + FROZEN_AFTER_ANSWER_MS - 1)).toBe(false)
    expect(watch.frozen(50 * MIN + FROZEN_AFTER_ANSWER_MS)).toBe(true)
  })
})

describe('restarts by the app', () => {
  const H = 60 * MIN
  it('are at most 3 in 6 hours', () => {
    const now = 100 * H
    expect(restartAllowed(now, [])).toBe(true)
    expect(restartAllowed(now, [now - H, now - 2 * H])).toBe(true)
    expect(restartAllowed(now, [now - H, now - 2 * H, now - 5 * H])).toBe(false)
    expect(
      restartAllowed(now, [now - H, now - 2 * H, now - RESTART_WINDOW_MS])
    ).toBe(true)
  })

  it('ignore a restart dated after now (the clock moved back)', () => {
    const now = 100 * H
    expect(restartAllowed(now, [now + H, now + H, now + H])).toBe(true)
  })
})
