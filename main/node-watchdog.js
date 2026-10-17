// Runs the built-in node's watch (main/node-watch.js) in the main process: reads the node every
// READ_INTERVAL_MS, and on a node that stopped answering writes a report (main/node-reports.js) with its
// goroutines and has the app restart it, as the phone app does. Also makes a report on the user's click.

const {
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  createNodeWatch,
  restartAllowed,
} = require('./node-watch')

const HAND_REPORT_STACKS =
  'Not taken: the node runs on. The app takes them when it restarts a node that stopped answering (not on Windows).'

/**
 * `nodeProcess` (main/node-process.js), `nodeRpc(method)` the node's answer, `reports` (main/node-reports.js),
 * `onRestart()` has the app start the node again after the stop; `now()` a monotonic clock, `wallNow()` the
 * wall clock.
 */
function createNodeWatchdog({
  nodeProcess,
  nodeRpc,
  reports,
  onRestart,
  logger,
  now = () => performance.now(),
  wallNow = () => Date.now(),
}) {
  let watch = null
  let freezeHandled = false

  async function handleFreeze(silentFor) {
    const allowed = restartAllowed(wallNow(), reports.restarts())
    const minutes = Math.floor(silentFor / 60000)
    const why = `The node had not answered for ${minutes} min. ${
      allowed
        ? 'The app restarted it.'
        : `The app did not restart it: it had restarted it ${MAX_RESTARTS} times in ${
            RESTART_WINDOW_MS / 3600000
          } h.`
    }`
    logger.warn(why)
    if (!allowed) {
      reports.write({
        why,
        stacksMissing:
          'Not taken: the app left the node running, for the user to restart it.',
      })
      return
    }
    reports.recordRestart(wallNow())
    watch = null
    const {log, stacks} = await nodeProcess.quit()
    logger.info(log)
    reports.write({
      why,
      stacks,
      stacksMissing:
        'Not written: the node was stopped without writing them (a node stopped as a whole cannot; Windows has no SIGQUIT).',
    })
    onRestart()
  }

  return {
    /** The node (re)started. */
    started() {
      watch = createNodeWatch(now())
      freezeHandled = false
    },
    /** The node wrote these log lines. */
    logged(lines) {
      watch?.logged(lines)
    },
    /** One read of the node, every READ_INTERVAL_MS. */
    async read() {
      const current = watch
      if (!current || !nodeProcess.current) return
      let answered = false
      try {
        await nodeRpc('bcn_syncing')
        answered = true
      } catch {
        answered = false
      }
      // The node was stopped or started again during the read.
      if (watch !== current || !nodeProcess.current) return
      if (answered) {
        current.answered(now())
        freezeHandled = false
        return
      }
      current.failed(now())
      if (!freezeHandled && current.frozen(now())) {
        freezeHandled = true
        try {
          await handleFreeze(current.silentFor(now()))
        } catch (e) {
          logger.error('node watchdog', e.toString())
        }
      }
    },
    /** A report on the user's click, from the running node. */
    makeReport() {
      if (!nodeProcess.current) throw new Error('the node does not run')
      return reports.write({
        why: 'Made by the user in the Advanced settings.',
        stacksMissing: HAND_REPORT_STACKS,
      })
    },
  }
}

module.exports = {createNodeWatchdog}
