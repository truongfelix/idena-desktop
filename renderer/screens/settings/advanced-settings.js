import {EpochPeriod} from '../../shared/types'
import {
  DB_WRITE_BUFFER_SIZES,
  IPFS_WRITE_BUFFER_SIZES,
} from '../../../main/node-write-buffer'
import {
  DEFAULT_IPFS_CONNECTIONS,
  DEFAULT_PEER_LEVEL,
  IPFS_CONNECTION_LIMITS,
  PEER_LEVELS,
  ipfsConnectionsFor,
  maxPeers,
} from '../../../main/node-peers'
import {
  cleanDirectPeers,
  directPeerIds,
  shortPeerId,
} from '../../../main/direct-peers'

/** The write buffer size the node runs with unless another is chosen: idena-go's, the phone app's too. */
export const DEFAULT_WRITE_BUFFER_MIB = 4

/**
 * The write buffer sizes of the Node settings, as the phone app names them. At idena-go's 4 MiB the node
 * rewrites about 16 times the new data (mainnet blocks replayed at the chain's pace, 2026-10-01).
 */
const writeBuffers = (sizes) =>
  sizes.map((mib) => ({
    mib,
    label: mib === DEFAULT_WRITE_BUFFER_MIB ? 'Default' : `${mib} MiB`,
  }))

export const DB_WRITE_BUFFERS = writeBuffers([4, 16, 32, 64])

if (
  DB_WRITE_BUFFERS.map(({mib}) => mib).join() !== DB_WRITE_BUFFER_SIZES.join()
) {
  throw new Error('write buffer sizes differ from main/node-write-buffer.js')
}

/** The IPFS datastore write buffer sizes, the same. */
export const IPFS_WRITE_BUFFERS = writeBuffers([4, 16, 32, 64])

/** What each write buffer's description ends with. */
export const WRITE_BUFFER_NOTE =
  'A bigger buffer needs more RAM but writes less to the disk. The node takes it at its start'

if (
  IPFS_WRITE_BUFFERS.map(({mib}) => mib).join() !==
  IPFS_WRITE_BUFFER_SIZES.join()
) {
  throw new Error(
    'IPFS write buffer sizes differ from main/node-write-buffer.js'
  )
}

/** The peer levels (main/node-peers.js), with the phone app's words. */
export const PEER_LEVEL_CHOICES = [
  {
    value: 'eco',
    label: 'Eco',
    detail:
      'Less traffic, but after a network drop the node can take longer to find peers again',
  },
  {
    value: 'normal',
    label: 'Normal',
    detail: 'The default, as in the official Idena app',
  },
  {
    value: 'hub',
    label: 'Hub',
    detail:
      'More room for nodes that connect to this computer. It helps only when nodes outside can reach it (a port open on the router), and uses more traffic',
  },
].map((choice) => ({
  ...choice,
  maxPeers: maxPeers(choice.value),
  isDefault: choice.value === DEFAULT_PEER_LEVEL,
}))

if (
  PEER_LEVEL_CHOICES.map(({value}) => value).join() !==
  Object.keys(PEER_LEVELS).join()
) {
  throw new Error('peer levels differ from main/node-peers.js')
}

/** The IPFS connection limits (main/node-peers.js); 0 keeps every connection. */
export const IPFS_CONNECTION_CHOICES = IPFS_CONNECTION_LIMITS.map(({high}) => ({
  high,
  label: high === 0 ? 'No limit' : String(high),
  isDefault: high === DEFAULT_IPFS_CONNECTIONS,
}))

/**
 * Whether the running node uses another setting than the one chosen: it applies at the next start. Never for
 * a node binary without the flag (`supported` false): a restart would not change it.
 */
export function optionPending({nodeStarted, running, chosen, supported}) {
  return (
    Boolean(nodeStarted) &&
    supported !== false &&
    running != null &&
    running !== chosen
  )
}

/**
 * The Advanced settings the running node does not use yet, in their order on the page: `{title, value}`
 * each. `running` and `supported` are what the node reported at its start (main/idena-node.js).
 */
export function pendingNodeOptions({
  nodeStarted,
  running,
  supported,
  settings,
}) {
  const peerLevel = PEER_LEVEL_CHOICES.find(
    ({value}) => value === settings.peerLevel
  )
  const ipfsConnections = ipfsConnectionsFor(
    settings.ipfsConnections,
    settings.peerLevel
  )
  const rows = [
    {
      title: 'Peer level',
      running: running?.peerLevel,
      chosen: settings.peerLevel,
      supported: supported?.peerLimits,
      value: peerLevel?.label,
    },
    {
      title: 'IPFS connections',
      running: running?.ipfsConnections,
      chosen: ipfsConnections,
      supported: supported?.peerLimits,
      value: IPFS_CONNECTION_CHOICES.find(({high}) => high === ipfsConnections)
        ?.label,
    },
    {
      title: 'Chain database buffer',
      running: running?.dbWriteBufferMiB,
      chosen: settings.dbWriteBufferMiB,
      supported: supported?.dbWriteBuffer,
      value: `${settings.dbWriteBufferMiB} MiB`,
    },
    {
      title: 'IPFS database buffer',
      running: running?.ipfsWriteBufferMiB,
      chosen: settings.ipfsWriteBufferMiB,
      supported: supported?.ipfsWriteBuffer,
      value: `${settings.ipfsWriteBufferMiB} MiB`,
    },
    // The node takes the ids only, compared sorted: a renamed peer needs no restart.
    {
      title: 'Direct peers',
      running: running?.directPeers?.join(','),
      chosen: directPeerIds(settings.directPeers).join(','),
      supported: supported?.directPeers,
      value:
        cleanDirectPeers(settings.directPeers)
          .map((peer) => peer.name || shortPeerId(peer.id))
          .join(', ') || 'none',
    },
  ]
  return rows
    .filter((row) => optionPending({nodeStarted, ...row}))
    .map(({title, value}) => ({title, value}))
}

const RESTART_MARGIN_MS = 3 * 60 * 60 * 1000

/**
 * Why a node restart at `now` is a risk, or null: after a restart the node looks for peers again. During the
 * validation `canRestart` is false; within 3 hours before it, a warning.
 */
export function restartRisk(now, epoch) {
  const period = epoch?.currentPeriod
  if (period && period !== EpochPeriod.None) {
    return {
      message: 'The validation is running: restart the node after it.',
      canRestart: false,
    }
  }
  const start = epoch?.nextValidation ? new Date(epoch.nextValidation) : null
  const left = start ? start.getTime() - now.getTime() : NaN
  if (left > 0 && left < RESTART_MARGIN_MS) {
    return {
      message:
        'The validation starts soon: the node may still be looking for peers then.',
      canRestart: true,
    }
  }
  return null
}

/**
 * How a direct peer stands, for its row: 'connected' when among the node's peers (`peerIds`, a Set from
 * net_peers), 'after a restart' when the running node was not given it, 'node stopped' when the node does not
 * answer (`peerIds` null).
 */
export function directPeerState(id, {peerIds, running}) {
  if (!peerIds) return 'node stopped'
  if (peerIds.has(id)) return 'connected'
  if (Array.isArray(running?.directPeers) && !running.directPeers.includes(id))
    return 'after a restart'
  return 'not connected'
}
