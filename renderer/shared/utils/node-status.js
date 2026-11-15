// The node status shown top left (sidebar), from the chain state and net_peers (B-245).

export const NodeStatus = {
  Compacting: 'compacting',
  NoPeers: 'noPeers',
  Converting: 'converting',
  Synchronizing: 'synchronizing',
  Behind: 'behind',
  Synchronized: 'synchronized',
}

// An empty peer list counts as No peers only after this long: a node starting, or between two peers, dials for
// some seconds (B-245 review).
export const NO_PEERS_MS = 30 * 1000

// The peers from net_peers (`peers`: its list, null or undefined while unknown) counted as in, out and direct: a
// direct peer (P2P.DirectPeers) counts once, as direct. `directions` is false for a node that does not give the
// direction (no `inbound` field: older than B-245), whose in and out are then unknown.
export function peerCounts(peers) {
  const list = Array.isArray(peers) ? peers : []
  const direct = list.filter((p) => p && p.direct).length
  const others = list.filter((p) => p && !p.direct)
  const directions =
    Array.isArray(peers) && others.every((p) => typeof p.inbound === 'boolean')
  const inbound = others.filter((p) => p.inbound === true).length
  return {
    known: Array.isArray(peers),
    total: list.length,
    inbound,
    outbound: others.length - inbound,
    direct,
    directions,
  }
}

// Which status wins: a compaction (the node serves nothing else meanwhile), then no peers (known and 0 for
// NO_PEERS_MS, `emptyForMs`: nothing the node sends or receives reaches the network), then the IPFS conversion, the
// sync, an old head, synchronized.
export function nodeStatus({
  syncing,
  compacting,
  converting,
  isBehind,
  peers,
  emptyForMs = 0,
}) {
  if (compacting) return NodeStatus.Compacting
  if (Array.isArray(peers) && peers.length === 0 && emptyForMs >= NO_PEERS_MS)
    return NodeStatus.NoPeers
  if (syncing)
    return converting ? NodeStatus.Converting : NodeStatus.Synchronizing
  if (isBehind) return NodeStatus.Behind
  return NodeStatus.Synchronized
}
