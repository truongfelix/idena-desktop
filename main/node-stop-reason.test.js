const {createNodeOutputTail, nodeStopReason} = require('./node-stop-reason')

// The node's own last lines, as idena-go wrote them on this PC (2026-10-22, its output piped as the app reads it).
const BROKEN_CONFIG = [
  "\u001b[31mERROR\u001b[0m[10-22|11:48:29.494] Cannot parse JSON config, path: bad.json: invalid character 'b' looking for beginning of object key string ",
  "\u001b[31mERROR\u001b[0m[10-22|11:48:29.494] Cannot parse JSON config, path: bad.json: invalid character 'b' looking for beginning of object key string ",
]
const RPC_PORT_TAKEN = [
  '\u001b[32mINFO \u001b[0m[10-22|11:48:35.829] Ceremony blocks found in the stored headers \u001b[32mcomponent\u001b[0m=identityhistory \u001b[32mheaders\u001b[0m=1 \u001b[32mceremonies\u001b[0m=0 \u001b[32mduration\u001b[0m=44.161µs',
  '\u001b[32mINFO \u001b[0m[10-22|11:48:35.830] Refreshed Idena protocol advertisement   \u001b[32mclosedPeers\u001b[0m=15 \u001b[32mfailedPeers\u001b[0m=0',
  '\u001b[31mERROR\u001b[0m[10-22|11:48:35.831] cannot start RPC endpoint: listen tcp 127.0.0.1:39111: bind: address already in use ',
]
const NODE_PORT_TAKEN = [
  '\u001b[32mINFO \u001b[0m[10-22|11:48:43.641] initial HTTP endpoint opened             \u001b[32murl\u001b[0m=http://localhost:39121 \u001b[32mcors\u001b[0m=* \u001b[32mvhosts\u001b[0m=localhost',
  '\u001b[32mINFO \u001b[0m[10-22|11:48:43.645] Skip DB compaction                       \u001b[32maboveDeepestLevel\u001b[0m=0.0%',
  '\u001b[31mERROR\u001b[0m[10-22|11:48:43.646] cannot start IPFS node on port 39123, err: listen tcp :39123: bind: address already in use ',
]
const FOLDER_IN_USE = [
  '\u001b[31mERROR\u001b[0m[10-22|11:48:51.698] Cannot transform consensus config        \u001b[31merr\u001b[0m="resource temporarily unavailable"',
  '\u001b[31mERROR\u001b[0m[10-22|11:48:51.698] open chain database: resource temporarily unavailable ',
]
const INFO = (n) =>
  `\u001b[32mINFO \u001b[0m[10-22|11:50:${String(n % 60).padStart(
    2,
    '0'
  )}.000] Block synced`

const exit1 = {code: 1, signal: null}

describe('nodeStopReason', () => {
  it.each([
    [
      'a broken config file',
      BROKEN_CONFIG,
      'config-broken',
      "Cannot parse JSON config, path: bad.json: invalid character 'b' looking for beginning of object key string",
    ],
    [
      'a taken RPC port',
      RPC_PORT_TAKEN,
      'rpc-port-taken',
      'cannot start RPC endpoint: listen tcp 127.0.0.1:39111: bind: address already in use',
    ],
    [
      'a taken node port',
      NODE_PORT_TAKEN,
      'node-port-taken',
      'cannot start IPFS node on port 39123, err: listen tcp :39123: bind: address already in use',
    ],
    [
      'a node folder another node uses',
      FOLDER_IN_USE,
      'data-folder-in-use',
      'open chain database: resource temporarily unavailable',
    ],
  ])('names %s from the node’s last error', (_, lines, cause, line) => {
    expect(nodeStopReason(lines, exit1)).toEqual({
      cause,
      line,
      code: 1,
      signal: null,
    })
  })

  it('gives an unknown error as the node wrote it, without a cause', () => {
    const lines = [
      INFO(1),
      'ERROR[10-22|11:50:02.000] cannot load identity state: some new reason ',
    ]
    expect(nodeStopReason(lines, exit1)).toMatchObject({
      cause: null,
      line: 'cannot load identity state: some new reason',
    })
  })

  it('gives the panic’s first line, not the stack after it', () => {
    const lines = [
      'ERROR[10-22|11:50:01.000] a peer sent a bad block ',
      'panic: runtime error: index out of range [3] with length 3',
      '',
      'goroutine 112 [running]:',
      'github.com/idena-network/idena-go/core/state.(*StateDB).Root(...)',
      '\t/build/core/state/statedb.go:212 +0x1a4',
    ]
    expect(nodeStopReason(lines, {code: 2, signal: null}).line).toBe(
      'panic: runtime error: index out of range [3] with length 3'
    )
  })

  it('takes no error from long before the exit: a node that ran on after it', () => {
    const lines = [
      'ERROR[10-22|11:00:00.000] address already in use, retrying ',
      ...Array.from({length: 40}, (_, i) => INFO(i)),
    ]
    expect(nodeStopReason(lines, exit1)).toMatchObject({
      cause: null,
      line: null,
    })
  })

  it('takes no error for a node killed by a signal: it wrote no reason', () => {
    expect(
      nodeStopReason(RPC_PORT_TAKEN, {code: null, signal: 'SIGKILL'})
    ).toEqual({cause: null, line: null, code: null, signal: 'SIGKILL'})
  })
})

describe('createNodeOutputTail', () => {
  it('keeps the last lines, without colours, from the latest start', () => {
    const tail = createNodeOutputTail(3)
    tail.add(['old line'])
    tail.clear()
    tail.add([INFO(1), INFO(2)])
    tail.add(RPC_PORT_TAKEN)
    expect(tail.lines).toHaveLength(3)
    expect(tail.lines[2]).toBe(
      'ERROR[10-22|11:48:35.831] cannot start RPC endpoint: listen tcp 127.0.0.1:39111: bind: address already in use'
    )
    expect(nodeStopReason(tail.lines, exit1).cause).toBe('rpc-port-taken')
  })
})
