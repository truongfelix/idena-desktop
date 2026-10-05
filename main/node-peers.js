// The peer levels of the Node settings, the same as the phone app's: the node's peer slots, incoming and
// outgoing, each for peers of its own shard and of other shards (idena-go protocol/connmanager.go). Eco has
// idena-go's low-power numbers, Normal its defaults, Hub twice the incoming slots, which only nodes that reach
// this computer (its port open on the router) can use.
const PEER_LEVELS = {
  eco: {
    inboundOwnShard: 3,
    inboundOtherShards: 1,
    outboundOwnShard: 2,
    outboundOtherShards: 1,
  },
  normal: {
    inboundOwnShard: 8,
    inboundOtherShards: 4,
    outboundOwnShard: 4,
    outboundOtherShards: 2,
  },
  hub: {
    inboundOwnShard: 16,
    inboundOtherShards: 8,
    outboundOwnShard: 4,
    outboundOtherShards: 2,
  },
}
const DEFAULT_PEER_LEVEL = 'normal'

// The IPFS connection limits: above `high` the node's connection manager closes the least used connections
// down to `low`, Idena peers last; 0 keeps every connection. 50 is idena-go's default on a computer.
const IPFS_CONNECTION_LIMITS = [
  {high: 20, low: 12},
  {high: 50, low: 30},
  {high: 100, low: 50},
  {high: 0, low: 0},
]
const DEFAULT_IPFS_CONNECTIONS = 50

// The connections a limit keeps beyond the level's Idena peers once trimmed: the node picks new peers among
// its IPFS connections.
const IPFS_CONNECTIONS_MARGIN = 5

/** The most Idena peers of `level`. */
function maxPeers(level) {
  const slots = PEER_LEVELS[level]
  return slots
    ? slots.inboundOwnShard +
        slots.inboundOtherShards +
        slots.outboundOwnShard +
        slots.outboundOtherShards
    : 0
}

/** Whether `level` can run with the IPFS connection limit `high`. */
function ipfsConnectionsAllow(high, level) {
  const limit = IPFS_CONNECTION_LIMITS.find((it) => it.high === high)
  if (!limit || !PEER_LEVELS[level]) return false
  return (
    limit.high === 0 || limit.low >= maxPeers(level) + IPFS_CONNECTIONS_MARGIN
  )
}

/**
 * The limit `high` if `level` can run with it, else the next higher one it can (an unknown limit counts as
 * the default; no limit for an unknown level).
 */
function ipfsConnectionsFor(high, level) {
  const known = IPFS_CONNECTION_LIMITS.some((it) => it.high === high)
  const from = IPFS_CONNECTION_LIMITS.findIndex(
    (it) => it.high === (known ? high : DEFAULT_IPFS_CONNECTIONS)
  )
  return (
    IPFS_CONNECTION_LIMITS.slice(from).find((it) =>
      ipfsConnectionsAllow(it.high, level)
    )?.high ?? 0
  )
}

/** Whether a node binary has the peer and IPFS connection limit flags, from its `--help` text. */
function nodeSupportsPeerLimits(helpText) {
  const help = String(helpText || '')
  return (
    help.includes('--maxinboundownshardpeers') &&
    help.includes('--ipfshighwater')
  )
}

/**
 * The node arguments for the peer level `level` and the IPFS connection limit `ipfsHigh` (raised to one the
 * level can run with): none for an unknown level, or when the node binary does not know the flags (an
 * official binary would not start with them). The flags override idena-go's profile.
 */
function peerLimitArgs(level, ipfsHigh, helpText) {
  const slots = PEER_LEVELS[level]
  if (!slots || !nodeSupportsPeerLimits(helpText)) return []
  const high = ipfsConnectionsFor(ipfsHigh, level)
  const {low} = IPFS_CONNECTION_LIMITS.find((it) => it.high === high)
  return [
    '--maxinboundownshardpeers',
    String(slots.inboundOwnShard),
    '--maxinboundpeers',
    String(slots.inboundOtherShards),
    '--maxoutboundownshardpeers',
    String(slots.outboundOwnShard),
    '--maxoutboundpeers',
    String(slots.outboundOtherShards),
    '--ipfslowwater',
    String(low),
    '--ipfshighwater',
    String(high),
  ]
}

module.exports = {
  PEER_LEVELS,
  DEFAULT_PEER_LEVEL,
  IPFS_CONNECTION_LIMITS,
  DEFAULT_IPFS_CONNECTIONS,
  IPFS_CONNECTIONS_MARGIN,
  maxPeers,
  ipfsConnectionsAllow,
  ipfsConnectionsFor,
  nodeSupportsPeerLimits,
  peerLimitArgs,
}
