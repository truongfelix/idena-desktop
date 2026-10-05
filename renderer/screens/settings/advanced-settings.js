import {EpochPeriod} from '../../shared/types'
import {
  DB_WRITE_BUFFER_SIZES,
  IPFS_WRITE_BUFFER_SIZES,
} from '../../../main/node-write-buffer'
import {
  IPFS_CONNECTION_LIMITS,
  PEER_LEVELS,
  ipfsConnectionsFor,
  maxPeers,
} from '../../../main/node-peers'

/**
 * The write buffer sizes of the Node settings, with what each is for. Figures measured on mainnet blocks
 * replayed at the chain's pace (2026-10-01): at 4 MiB the node rewrites about 16 times the new data.
 */
export const DB_WRITE_BUFFERS = [
  {mib: 4, label: 'Idena default', detail: 'most disk writes, least memory'},
  {mib: 16, label: 'Optimal', detail: 'about 65% fewer writes, +15-30 MB'},
  {
    mib: 32,
    label: 'Phone with 4 GB+ RAM',
    detail: 'about 75% fewer writes, +60-90 MB',
  },
  {mib: 64, label: 'Computer', detail: 'about 85% fewer writes, +200-270 MB'},
]

if (
  DB_WRITE_BUFFERS.map(({mib}) => mib).join() !== DB_WRITE_BUFFER_SIZES.join()
) {
  throw new Error('write buffer sizes differ from main/node-write-buffer.js')
}

/** The IPFS datastore write buffer sizes. It writes the most when nodes outside can reach this computer. */
export const IPFS_WRITE_BUFFERS = [
  {mib: 4, label: 'Idena default'},
  {mib: 16, label: '16 MiB'},
  {mib: 32, label: '32 MiB'},
  {mib: 64, label: '64 MiB'},
]

if (
  IPFS_WRITE_BUFFERS.map(({mib}) => mib).join() !==
  IPFS_WRITE_BUFFER_SIZES.join()
) {
  throw new Error(
    'IPFS write buffer sizes differ from main/node-write-buffer.js'
  )
}

/** The peer levels (main/node-peers.js), the same as the phone app's. */
export const PEER_LEVEL_CHOICES = [
  {
    value: 'eco',
    label: 'Eco',
    detail:
      'Less traffic, but after a network drop the node can take longer to find peers again',
  },
  {value: 'normal', label: 'Normal', detail: 'Idena default'},
  {
    value: 'hub',
    label: 'Hub',
    detail:
      'More room for nodes that connect to this computer: it helps only when its port is open on the router',
  },
].map((choice) => ({...choice, maxPeers: maxPeers(choice.value)}))

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
      title: 'Chain database write buffer',
      running: running?.dbWriteBufferMiB,
      chosen: settings.dbWriteBufferMiB,
      supported: supported?.dbWriteBuffer,
      value: `${settings.dbWriteBufferMiB} MiB`,
    },
    {
      title: 'IPFS database write buffer',
      running: running?.ipfsWriteBufferMiB,
      chosen: settings.ipfsWriteBufferMiB,
      supported: supported?.ipfsWriteBuffer,
      value: `${settings.ipfsWriteBufferMiB} MiB`,
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
