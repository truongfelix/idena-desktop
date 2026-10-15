// The steps of a sync as the app names them (the phone's SyncSteps.kt). bcn_syncing's currentBlock is the fast
// sync's headers when the node holds some above its chain (bcn_lastBlock), else the chain; a fast sync downloads
// the headers, then one snapshot (the state), and only then the chain jumps up. While it waits for a snapshot it
// may full sync slices of blocks, the headers kept: the chain then moves and the headers do not.

export const SyncPhase = {
  Headers: 'headers',
  Snapshot: 'snapshot',
  Blocks: 'blocks',
}

// Headers this close to the top are all there: the fast sync stops them at the newest snapshot's height, and
// snapshots are 1000 blocks apart on mainnet.
export const SNAPSHOT_RANGE = 1000
const HEADERS_AT_TOP = SNAPSHOT_RANGE + 100

// A head block older than this, with the node saying it is synced, means it is behind: blocks come about every
// 20 s, empty ones included.
export const STALE_HEAD_SECONDS = 10 * 60

// The step of a sync: `chain` the chain's height (bcn_lastBlock), `headers` bcn_syncing's currentBlock,
// `highest` its highestBlock, `chainMoving` whether the chain grew lately. The top is never below what the node
// holds. Returns {phase, done, total}.
export function syncStep({chain, headers, highest, chainMoving}) {
  const ownChain = Number.isFinite(chain) && chain > 0 ? chain : headers || 0
  const ownHeaders = headers || 0
  const total = Math.max(highest || 0, ownHeaders, ownChain)
  if (ownHeaders <= ownChain || chainMoving)
    return {phase: SyncPhase.Blocks, done: ownChain, total}
  return total - ownHeaders > HEADERS_AT_TOP
    ? {phase: SyncPhase.Headers, done: ownHeaders, total}
    : {phase: SyncPhase.Snapshot, done: ownChain, total}
}

// The share of a step done, 0 to 99: a node one block short says 99%.
export function stepPercent({done, total}) {
  if (!total || total <= 0) return 0
  return Math.min(99, Math.max(0, Math.floor((done / total) * 100)))
}

export function stepRemaining({done, total}) {
  return Math.max((total || 0) - (done || 0), 0)
}

// Whether a node that says it is synced is in fact behind: its head block, made at `headTime`, is old at `now`
// (both in seconds).
export function headIsStale(headTime, now) {
  return (
    Number.isFinite(headTime) &&
    headTime > 0 &&
    now - headTime > STALE_HEAD_SECONDS
  )
}

// Blocks per second over the last minute, from the heights read: `samples` [{time, block}] (ms), returned with
// the new one added. The rate is null until 10 s are measured; a lower block means the node started over.
export function addRateSample(samples, block, time) {
  const kept =
    samples.length && block < samples[samples.length - 1].block ? [] : samples
  const next = [...kept, {time, block}]
  while (next.length > 2 && time - next[1].time >= 60 * 1000) next.shift()
  const [first] = next
  const seconds = (time - first.time) / 1000
  return {
    samples: next,
    rate: seconds >= 10 ? (block - first.block) / seconds : null,
  }
}

// The time left, rounded to the minute: {hours, minutes}, minutes 0 to 59.
export function durationParts(seconds) {
  const total = Math.round(seconds / 60)
  return {hours: Math.floor(total / 60), minutes: total % 60}
}
