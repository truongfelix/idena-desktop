import React from 'react'
import {useInterval} from '../../shared/hooks/use-interval'
import {useChainState} from '../../shared/providers/chain-context'
import {HASH_IN_MEMPOOL, callRpc} from '../../shared/utils/utils'

// A ceremony's blocks come about every 20 s: a head older than this, or no peer twice in a row, means the answers
// the node sends reach no one.
export const HEAD_STUCK_SECONDS = 3 * 60
export const NO_PEER_CHECKS = 2
// An answers transaction not in a block this long after it was sent is shown as late.
export const TX_LATE_SECONDS = 3 * 60

const PEERS_POLL_MS = 5 * 1000
const TX_POLL_MS = 10 * 1000

// Whether the node has no connection: `noPeerChecks` net_peers answers in a row were empty, or the head block
// (`headTime`, seconds) has not moved for HEAD_STUCK_SECONDS at `now` (seconds).
export function connectionLost({noPeerChecks, headTime, now}) {
  if (noPeerChecks >= NO_PEER_CHECKS) return true
  return (
    Number.isFinite(headTime) &&
    headTime > 0 &&
    now - headTime > HEAD_STUCK_SECONDS
  )
}

// Whether a transaction read with bcn_transaction (`tx`, null when the node does not know it) is in a block.
export function isInBlock(tx) {
  return Boolean(tx && tx.blockHash && tx.blockHash !== HASH_IN_MEMPOOL)
}

// 'mined', 'waiting' or 'late' for a transaction sent at `sentAt` (ms; null when not known) and seen
// `seenSince` (ms, when the screen began to follow it), at `now` (ms).
export function txWaitState({mined, sentAt, seenSince, now}) {
  if (mined) return 'mined'
  const since = Number.isFinite(sentAt) ? sentAt : seenSince
  return now - since > TX_LATE_SECONDS * 1000 ? 'late' : 'waiting'
}

// The node's connection while the validation runs: `lost` once the node answers but has no peer or a head that
// does not move (a node that does not answer at all is the chain state's `offline`).
export function useNodeConnection() {
  const {offline, headTime} = useChainState()
  const [noPeerChecks, setNoPeerChecks] = React.useState(0)
  const [now, setNow] = React.useState(() => Date.now())

  useInterval(
    async () => {
      setNow(Date.now())
      try {
        const peers = await callRpc('net_peers')
        setNoPeerChecks((n) => ((peers || []).length > 0 ? 0 : n + 1))
      } catch {
        // The node does not answer: the chain state shows it offline.
      }
    },
    PEERS_POLL_MS,
    true
  )

  return {
    lost:
      !offline &&
      connectionLost({noPeerChecks, headTime, now: Math.floor(now / 1000)}),
  }
}

// Follows the answers transaction `hash` until a block holds it: 'mined', 'waiting', 'late' (sent more than
// TX_LATE_SECONDS ago, `sentAt` in ms) or null without a hash.
export function useAnswersTx(hash, sentAt) {
  const [mined, setMined] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())
  const seenSince = React.useRef(Date.now())

  React.useEffect(() => {
    setMined(false)
    seenSince.current = Date.now()
  }, [hash])

  useInterval(
    async () => {
      setNow(Date.now())
      try {
        if (isInBlock(await callRpc('bcn_transaction', hash))) setMined(true)
      } catch {
        // Not known to the node (yet): still waiting.
      }
    },
    hash && !mined ? TX_POLL_MS : null,
    true
  )

  if (!hash) return null
  return txWaitState({mined, sentAt, seenSince: seenSince.current, now})
}

// The one alert the validation screen shows at the top: 'offline' (the node does not answer), 'noConnection' (no
// peer or a head that does not move: bcn_syncing then says syncing too, a node without peers counts as syncing, so
// this comes before 'syncing'), 'syncing', 'shortLate' (the short answers' hash not in a block, long session) or null.
export function validationAlert({
  offline,
  syncing,
  connectionLost: lost,
  shortAnswersTx,
  inLongSession,
}) {
  if (offline) return 'offline'
  if (lost) return 'noConnection'
  if (syncing) return 'syncing'
  if (shortAnswersTx === 'late' && inLongSession) return 'shortLate'
  return null
}

// "About N min left" until `end` (ms) at `now` (ms).
export function timeLeftText(t, end, now) {
  const minutes = Math.floor(Math.max(0, end - now) / 60000)
  if (minutes < 1) return t('Under a minute left')
  return t('About {{minutes}} min left', {minutes})
}

// The long answers' transaction from the saved validation (an xstate State: the machine's fields are in its
// context), {hash, sentAt}; nulls when none was saved.
export function persistedLongAnswersTx(validationState) {
  const context = validationState?.context
  return {
    hash: context?.submitLongAnswersHash ?? null,
    sentAt: context?.submitLongAnswersAt ?? null,
  }
}

// What the screen after the submit says: `status` 'submitted' only once a block holds the answers, 'pending'
// while the node holds them, 'sent' when no transaction is known; `warning` 'noConnection' or 'late' while they
// are not in a block.
export function afterSubmitStatus({answersTx, connectionLost: lost}) {
  if (answersTx === 'mined') return {status: 'submitted', warning: null}
  let warning = null
  if (lost) warning = 'noConnection'
  else if (answersTx === 'late') warning = 'late'
  return {status: answersTx === null ? 'sent' : 'pending', warning}
}
