// The built-in node's watchdog, as in the phone app (idena-mobile NodeWatch.kt): on 2026-10-16 a phone's node
// stopped as a whole, no log line and no RPC, while the app went on saying "Starting". The main process reads
// the node every READ_INTERVAL_MS; when nothing answers for long enough, it writes a node report
// (main/node-reports.js) and restarts the node, at most MAX_RESTARTS times in RESTART_WINDOW_MS.

/** How often the main process reads the node. */
const READ_INTERVAL_MS = 15 * 1000

/** A node that answered once is stopped after this long without an answer: it answers every few seconds. */
const FROZEN_AFTER_ANSWER_MS = 5 * 60 * 1000

/**
 * A node that never answered since its start is stopped after this long: its RPC opens within seconds of the
 * start, after the database compaction (which counts as an answer, see `logged`); this leaves room for a slow
 * opening of IPFS.
 */
const FROZEN_WITHOUT_ANSWER_MS = 15 * 60 * 1000

/** Reads in a row without an answer before a node counts as stopped: a few slow answers are not a stop. */
const MIN_FAILED_READS = 8

/** At most this many restarts by the app in RESTART_WINDOW_MS: a node that stops again and again needs the user. */
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 6 * 60 * 60 * 1000

// idena-go compacts its database before it opens its RPC: 21 min once on a hard disk (2026-10-16).
const COMPACTION_START = 'Start compacting DB'
const COMPACTION_END = 'DB compacted'

/**
 * Tells a node that stopped answering from one that starts or syncs. Times are a monotonic clock
 * (`performance.now()`): it stops while the computer sleeps, and the node with it, so a night of sleep is no
 * silence. `startedAt`: when the node started.
 */
function createNodeWatch(startedAt) {
  let lastAnswerAt = null
  let failedReads = 0
  let compacting = false

  const silentFor = (now) => now - (lastAnswerAt ?? startedAt)

  return {
    /** The node answered at `now`. */
    answered(now) {
      lastAnswerAt = now
      failedReads = 0
    },
    /** A read found nothing that answers at `now`: while the node compacts its database, that is its start. */
    failed(now) {
      if (compacting) this.answered(now)
      else failedReads += 1
    },
    /** The node wrote these log lines. */
    logged(lines) {
      for (const line of lines) {
        if (line.includes(COMPACTION_START)) compacting = true
        if (line.includes(COMPACTION_END)) compacting = false
      }
    },
    silentFor,
    /** Whether the node counts as stopped at `now`. */
    frozen(now) {
      return (
        failedReads >= MIN_FAILED_READS &&
        silentFor(now) >=
          (lastAnswerAt !== null
            ? FROZEN_AFTER_ANSWER_MS
            : FROZEN_WITHOUT_ANSWER_MS)
      )
    },
  }
}

/** Whether the app may restart the node at `now`, after its restarts at `earlier` (wall clock, ms). */
function restartAllowed(now, earlier) {
  return (
    earlier.filter((at) => now - at >= 0 && now - at < RESTART_WINDOW_MS)
      .length < MAX_RESTARTS
  )
}

module.exports = {
  READ_INTERVAL_MS,
  FROZEN_AFTER_ANSWER_MS,
  FROZEN_WITHOUT_ANSWER_MS,
  MIN_FAILED_READS,
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  createNodeWatch,
  restartAllowed,
}
