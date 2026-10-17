// The built-in node's process, owned in one place: one node at a time, stops that wait for the process to
// exit, and exits told apart (asked for, or a failure). Without it the app could start a second node next to
// a running one and lose track of the first, report every stop as a failure (idena-go exits with code 1 on
// SIGINT, its key store's signal handler), miss a node killed by a signal (exit code null), and quit while
// the node kept running.

const hasExited = (child) =>
  child.exitCode !== null || child.signalCode !== null

/**
 * `options.signal(child, signal)` sends a signal to the node (tree-kill on Linux and macOS); `onFailed(message)`
 * is called when the node exits without being asked to; `stopTimeoutMs` is how long a stop waits before
 * killing the node.
 */
function createNodeProcess({
  signal,
  onFailed,
  logger,
  isWindows = process.platform === 'win32',
  stopTimeoutMs = 30000,
  killTimeoutMs = 5000,
}) {
  let current = null
  let starting = null
  let stopping = null

  const watch = (child) => {
    const onExit = (code, exitSignal) => {
      const message = `node ${child.pid} exited with code ${code}${
        exitSignal ? ` (${exitSignal})` : ''
      }`
      if (current === child) current = null
      if (child.stopRequested) {
        logger.info(message)
      } else {
        // An exit nobody asked for is a failure, whatever its code: a crash, the OOM killer, a kill.
        onFailed(message)
      }
    }
    if (hasExited(child)) {
      onExit(child.exitCode, child.signalCode)
    } else {
      child.once('exit', onExit)
    }
  }

  const waitForExit = (child, ms) =>
    new Promise((resolve) => {
      if (hasExited(child)) {
        resolve(true)
        return
      }
      const timer = setTimeout(() => resolve(false), ms)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })

  /**
   * Stops the node: SIGINT, or `quitSignal` when given (Linux and macOS only), then SIGKILL after
   * `stopTimeoutMs`. Resolves to a line for the log.
   */
  async function stop({quitSignal} = {}) {
    if (stopping) return stopping
    const child = current
    if (!child || hasExited(child)) {
      current = null
      return 'node is not running'
    }
    stopping = (async () => {
      // eslint-disable-next-line no-param-reassign
      child.stopRequested = true
      try {
        await signal(child, isWindows ? undefined : quitSignal || 'SIGINT')
        if (!(await waitForExit(child, stopTimeoutMs))) {
          logger.warn(`node ${child.pid} still running, killing it`)
          await signal(child, 'SIGKILL')
          await waitForExit(child, killTimeoutMs)
        }
      } finally {
        if (current === child) current = null
        stopping = null
      }
      return `node ${child.pid} stopped`
    })()
    return stopping
  }

  /**
   * Stops a node that stopped answering with SIGQUIT, on which Go writes the stack of each goroutine to the
   * node's error output before it exits. Resolves to `{log, stacks}`: `stacks` is that output, or null on
   * Windows (no SIGQUIT: a plain stop) and when no node runs.
   */
  async function quit() {
    const child = current
    if (isWindows || !child || hasExited(child) || !child.stderr) {
      return {log: await stop(), stacks: null}
    }
    const chunks = []
    const collect = (data) => chunks.push(String(data))
    child.stderr.on('data', collect)
    try {
      const log = await stop({quitSignal: 'SIGQUIT'})
      return {log, stacks: chunks.join('') || null}
    } finally {
      child.stderr.off('data', collect)
    }
  }

  /**
   * Starts the node with `spawnNode()` (a promise of the child process), unless one runs: then that one is
   * kept. A start during a stop waits for the stop.
   */
  async function start(spawnNode) {
    if (stopping) await stopping
    if (current && !hasExited(current)) return {child: current, started: false}
    if (starting) return starting
    starting = (async () => {
      try {
        const child = await spawnNode()
        current = child
        watch(child)
        return {child, started: true}
      } finally {
        starting = null
      }
    })()
    return starting
  }

  return {
    start,
    stop,
    quit,
    /** The running node's process, or null. */
    get current() {
      return current && !hasExited(current) ? current : null
    },
  }
}

module.exports = {createNodeProcess}
