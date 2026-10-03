import {EpochPeriod} from '../../shared/types'
import {DB_WRITE_BUFFER_SIZES} from '../../../main/node-write-buffer'

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

/** Whether the running node uses another write buffer than the one chosen: it applies at the next start. */
export function writeBufferPending({nodeStarted, runningMiB, chosenMiB}) {
  return Boolean(nodeStarted) && runningMiB != null && runningMiB !== chosenMiB
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
