import {
  SyncPhase,
  STALE_HEAD_SECONDS,
  addRateSample,
  durationParts,
  headIsStale,
  stepPercent,
  stepRemaining,
  syncStep,
} from './sync-steps'

describe('syncStep', () => {
  it('names the fast sync steps from the headers and the chain', () => {
    // A fast sync from scratch: the headers download, the chain stays.
    expect(syncStep({chain: 1, headers: 6000000, highest: 11430000})).toEqual({
      phase: SyncPhase.Headers,
      done: 6000000,
      total: 11430000,
    })
    // Galaxy, 2026-10-12 19:30: headers at the snapshot height, chain in 2022, its only peer syncing too.
    expect(
      syncStep({chain: 4873470, headers: 11429095, highest: 4875200})
    ).toEqual({phase: SyncPhase.Snapshot, done: 4873470, total: 11429095})
    // Headers within a snapshot range of the top: all there.
    expect(
      syncStep({chain: 4873470, headers: 11429095, highest: 11430011}).phase
    ).toBe(SyncPhase.Snapshot)
    // Xiaomi, 2026-10-12 22:30: headers stopped below the manifest, full sync slices of 2022 blocks.
    expect(
      syncStep({
        chain: 4875200,
        headers: 11087150,
        highest: 11430011,
        chainMoving: true,
      })
    ).toEqual({phase: SyncPhase.Blocks, done: 4875200, total: 11430011})
    // After the snapshot: the chain at the headers, then the last blocks.
    expect(
      syncStep({chain: 11429095, headers: 11429095, highest: 11430011})
    ).toEqual({phase: SyncPhase.Blocks, done: 11429095, total: 11430011})
    // A full sync without headers.
    expect(
      syncStep({chain: 8200, headers: 8200, highest: 10000, chainMoving: true})
    ).toEqual({phase: SyncPhase.Blocks, done: 8200, total: 10000})
  })

  it('counts blocks from the headers while the chain is not read yet', () => {
    expect(syncStep({chain: null, headers: 8200, highest: 10000})).toEqual({
      phase: SyncPhase.Blocks,
      done: 8200,
      total: 10000,
    })
  })
})

describe('stepPercent', () => {
  it('stays below 100 until the step is over', () => {
    expect(stepPercent({done: 6000000, total: 11460000})).toBe(52)
    expect(stepPercent({done: 9999, total: 10000})).toBe(99)
    expect(stepPercent({done: 10000, total: 10000})).toBe(99)
    expect(stepPercent({done: 5, total: 0})).toBe(0)
    expect(stepRemaining({done: 8200, total: 10000})).toBe(1800)
    expect(stepRemaining({done: 12, total: 10})).toBe(0)
  })
})

describe('headIsStale', () => {
  it('finds an old head block', () => {
    const now = 1760000000
    expect(headIsStale(now - 30, now)).toBe(false)
    expect(headIsStale(now - STALE_HEAD_SECONDS, now)).toBe(false)
    expect(headIsStale(now - STALE_HEAD_SECONDS - 1, now)).toBe(true)
    expect(headIsStale(undefined, now)).toBe(false)
    expect(headIsStale(0, now)).toBe(false)
  })
})

describe('addRateSample', () => {
  it('measures blocks per second over the last minute', () => {
    let state = addRateSample([], 100, 0)
    expect(state.rate).toBeNull()
    state = addRateSample(state.samples, 150, 5000)
    expect(state.rate).toBeNull()
    state = addRateSample(state.samples, 200, 10000)
    expect(state.rate).toBe(10)
    // Older samples leave the window.
    state = addRateSample(state.samples, 900, 70000)
    state = addRateSample(state.samples, 1000, 80000)
    expect(state.samples[0].time).toBeGreaterThan(0)
    expect(state.rate).toBeCloseTo((1000 - 200) / 70, 5)
  })

  it('starts over when the node went back', () => {
    let state = addRateSample([], 500, 0)
    state = addRateSample(state.samples, 600, 20000)
    state = addRateSample(state.samples, 10, 25000)
    expect(state.samples).toEqual([{time: 25000, block: 10}])
    expect(state.rate).toBeNull()
  })
})

describe('durationParts', () => {
  it('rounds to the minute', () => {
    expect(durationParts(10920)).toEqual({hours: 3, minutes: 2})
    expect(durationParts(180)).toEqual({hours: 0, minutes: 3})
    expect(durationParts(20)).toEqual({hours: 0, minutes: 0})
  })
})
