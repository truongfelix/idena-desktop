/* global BigInt */
// Direct peers: up to MAX_DIRECT_PEERS nodes the user names, which the built-in node keeps connected on top of its
// peer slots (idena-go --directpeers: accepted with no free slot, never dropped to make room, redialed when the
// connection drops). A node is named by its IPFS peer id; the node finds its address by a DHT lookup. Users
// exchange them as a peer code, one line, the same as in the phone app: `idena-peer:<peer id>#<name>`, the name
// optional.

const MAX_DIRECT_PEERS = 3
const CODE_PREFIX = 'idena-peer:'
const MAX_NAME_LENGTH = 40
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** A name for a code or the list: one line (a line break or tab reads as a space), at most 40 characters. */
function cleanPeerName(name) {
  return (
    String(name ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH)
      .trim()
  )
}

/** Base58 (Bitcoin alphabet) to bytes; null for an empty text or a character outside the alphabet. */
function decodeBase58(text) {
  if (!text) return null
  let value = BigInt(0)
  for (const c of text) {
    const digit = BASE58_ALPHABET.indexOf(c)
    if (digit < 0) return null
    value = value * BigInt(58) + BigInt(digit)
  }
  const bytes = []
  while (value > BigInt(0)) {
    bytes.unshift(Number(value % BigInt(256)))
    value /= BigInt(256)
  }
  let leadingZeros = 0
  while (text[leadingZeros] === '1') leadingZeros += 1
  return [...new Array(leadingZeros).fill(0), ...bytes]
}

/**
 * Whether `id` is a libp2p peer id as idena-go's nodes have them: base58 of a sha2-256 multihash (`Qm…`, RSA
 * keys) or of an identity multihash holding a short key (`12D3Koo…`, ed25519). Stricter than idena-go's check,
 * which takes any consistent multihash, so a list the app passes never stops the node's start.
 */
function isPeerId(id) {
  const bytes = decodeBase58(String(id ?? ''))
  if (!bytes || bytes.length < 2) return false
  const [code, length] = bytes
  if (code === 0x12) return length === 32 && bytes.length === 34
  if (code === 0x00)
    return length >= 1 && length <= 42 && bytes.length === 2 + length
  return false
}

/** The code that names a node: `id` and, when not blank, `name`. */
function peerCode(id, name) {
  const clean = cleanPeerName(name)
  return `${CODE_PREFIX}${id}${clean ? `#${clean}` : ''}`
}

/**
 * The node a pasted text names, {id, name}: a peer code, or a bare peer id. Null when it names none (the node
 * refuses a list with an invalid entry at its start, so only a valid peer id gets through).
 */
function parsePeerCode(text) {
  const line = String(text ?? '').trim()
  const body = line.toLowerCase().startsWith(CODE_PREFIX)
    ? line.slice(CODE_PREFIX.length)
    : line
  const hash = body.indexOf('#')
  const id = (hash < 0 ? body : body.slice(0, hash)).trim()
  const name = hash < 0 ? '' : cleanPeerName(body.slice(hash + 1))
  return isPeerId(id) ? {id, name} : null
}

/** Why `candidate` cannot join `list` next to the node's own id `ownId`, or null when it can. */
function directPeerProblem(candidate, list, ownId) {
  if (candidate.id === ownId) return "This is your own node's code."
  if (list.some((peer) => peer.id === candidate.id))
    return 'This node is already in the list.'
  if (list.length >= MAX_DIRECT_PEERS) return 'The list holds at most 3 nodes.'
  return null
}

/** The node's own peer id from `net_ipfsAddress` (`/ip4/0.0.0.0/tcp/40405/ipfs/<peer id>`); null if absent. */
function ownPeerId(ipfsAddress) {
  if (typeof ipfsAddress !== 'string') return null
  const last = ipfsAddress.trim().split('/').pop()
  return isPeerId(last) ? last : null
}

/** A peer id shortened for a list row: its start and its end. */
function shortPeerId(id) {
  return id.length <= 16 ? id : `${id.slice(0, 6)}…${id.slice(-6)}`
}

/** The stored list, cleaned: entries without a valid peer id dropped, each id once, at most 3. */
function cleanDirectPeers(peers) {
  const clean = []
  for (const peer of Array.isArray(peers) ? peers : []) {
    if (
      peer &&
      isPeerId(peer.id) &&
      !clean.some((it) => it.id === peer.id) &&
      clean.length < MAX_DIRECT_PEERS
    ) {
      clean.push({id: peer.id, name: cleanPeerName(peer.name)})
    }
  }
  return clean
}

/** The ids for the node, sorted: what it runs with and what the user chose compare as this. */
function directPeerIds(peers) {
  return cleanDirectPeers(peers)
    .map((peer) => peer.id)
    .sort()
}

/** Whether a node binary has the --directpeers flag, from its `--help` text. */
function nodeSupportsDirectPeers(helpText) {
  return String(helpText || '').includes('--directpeers')
}

/**
 * The node arguments for the direct peers: none for an empty list, or when the node binary does not know the
 * flag (an official binary would not start with it).
 */
function directPeerArgs(peers, helpText) {
  const ids = directPeerIds(peers)
  if (ids.length === 0 || !nodeSupportsDirectPeers(helpText)) return []
  return ['--directpeers', ids.join(',')]
}

module.exports = {
  MAX_DIRECT_PEERS,
  cleanPeerName,
  decodeBase58,
  isPeerId,
  peerCode,
  parsePeerCode,
  directPeerProblem,
  ownPeerId,
  shortPeerId,
  cleanDirectPeers,
  directPeerIds,
  nodeSupportsDirectPeers,
  directPeerArgs,
}
