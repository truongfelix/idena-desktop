// Why the built-in node stopped, for the troubleshooting screen: the node's own line (its last error, or the
// Go panic), and a known cause the window can say in the user's language. Without it the screen only offers
// Restart, Update and Reset, and Reset deletes the chain for a problem a closed program or a port fixes.

// The node's output lines kept: an error line comes last before the exit, a panic's stack can be long.
const TAIL_LINES = 200
// A node that ran for hours logs errors that did not stop it: only the last lines before the exit count.
const ERROR_WINDOW = 20

// idena-go's terminal format colours the level (not on Windows): `\x1b[31mERROR\x1b[0m[10-22|11:48:29.494] …`.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g
const ERROR_LINE = /^(ERROR|CRIT)\s*\[[^\]]*\]\s*(.*)$/
const PANIC_LINE = /^(panic|fatal error): /

// Causes known from the node's own lines (a node started on a taken port, a folder in use, a broken config).
const CAUSES = [
  {
    cause: 'rpc-port-taken',
    test: /cannot start RPC endpoint: .*address already in use/,
  },
  {
    cause: 'node-port-taken',
    test: /cannot start IPFS node on port .*address already in use/,
  },
  {cause: 'port-taken', test: /address already in use/},
  {
    cause: 'data-folder-in-use',
    test: /open chain database: resource temporarily unavailable/,
  },
  {cause: 'config-broken', test: /Cannot parse JSON config/},
]

const plain = (line) => String(line).replace(ANSI, '').trimEnd()

/** The node's last output lines, kept from its latest start. */
function createNodeOutputTail(size = TAIL_LINES) {
  let lines = []
  return {
    /** A new node starts: the lines of the one before no longer tell why this one stops. */
    clear() {
      lines = []
    },
    /** `logged` is one output chunk's lines (main/idena-node.js startNode's onLog). */
    add(logged) {
      lines.push(...logged.map(plain).filter((x) => x))
      if (lines.length > size) lines = lines.slice(lines.length - size)
    },
    get lines() {
      return lines.slice()
    },
  }
}

/**
 * Why the node stopped, from its last output `lines` and its exit (`code`, `signal`): `{cause, line}`. `line` is
 * the node's own text (the first panic line, else its last error among the last lines; null when it wrote
 * none), `cause` a known cause (CAUSES) or null.
 */
function nodeStopReason(lines, {code = null, signal = null} = {}) {
  const output = lines.map(plain)
  let line = output.find((x) => PANIC_LINE.test(x)) ?? null
  // A node killed by a signal (the system out of memory, a kill) wrote no reason: its last error is older.
  if (!line && !signal) {
    const last = output.slice(-ERROR_WINDOW)
    for (let i = last.length - 1; i >= 0; i -= 1) {
      const match = ERROR_LINE.exec(last[i])
      if (match) {
        line = match[2].trim()
        break
      }
    }
  }
  const known = line ? CAUSES.find(({test}) => test.test(line)) : null
  return {
    cause: known ? known.cause : null,
    line,
    code,
    signal,
  }
}

module.exports = {createNodeOutputTail, nodeStopReason}
