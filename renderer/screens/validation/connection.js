import React from 'react'
import {useInterval} from '../../shared/hooks/use-interval'
import {useChainState} from '../../shared/providers/chain-context'
import {HASH_IN_MEMPOOL, callRpc} from '../../shared/utils/utils'
import {durationParts, headIsStale} from '../../shared/utils/sync-steps'

// No peer twice in a row means the answers the node sends reach no one.
export const NO_PEER_CHECKS = 2
// An answers transaction not in a block this long after it was sent is shown as late.
export const TX_LATE_SECONDS = 3 * 60

const PEERS_POLL_MS = 5 * 1000
const TX_POLL_MS = 10 * 1000

// Whether the node has no connection: `noPeerChecks` net_peers answers in a row were empty, or the node says it
// is synced while its head block is old (`isBehind`, as the sidebar's; a node catching up with peers is syncing).
export function connectionLost({noPeerChecks, isBehind}) {
  return noPeerChecks >= NO_PEER_CHECKS || Boolean(isBehind)
}

// The transaction hash in what flip_submitShortAnswers / flip_submitLongAnswers returned: the node answers
// {txHash}, an older saved state may hold the bare hash; null otherwise.
export function answersTxHash(value) {
  if (typeof value === 'string') return value || null
  return (value && typeof value.txHash === 'string' && value.txHash) || null
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

// The node's connection while the validation runs: `lost` once the node answers but has no peer or an old head
// (a node that does not answer at all is the chain state's `offline`, returned too). Polls only while `enabled`;
// each poll renders again, so a time shown beside it stays current.
export function useNodeConnection(enabled = true) {
  const {offline, syncing, headTime} = useChainState()
  const [noPeerChecks, setNoPeerChecks] = React.useState(0)
  const [now, setNow] = React.useState(() => Date.now())

  useInterval(
    async () => {
      setNow(Date.now())
      try {
        const peers = await callRpc('net_peers')
        setNoPeerChecks((n) => ((peers || []).length > 0 ? 0 : n + 1))
      } catch {
        // The node does not answer: the chain state shows it offline; count again from zero once it is back.
        setNoPeerChecks(0)
      }
    },
    enabled ? PEERS_POLL_MS : null,
    true
  )

  const isBehind = !syncing && headIsStale(headTime, now / 1000)
  return {offline, lost: !offline && connectionLost({noPeerChecks, isBehind})}
}

// Follows the answers transaction `hash` until a block holds it: 'mined', 'waiting', 'late' (sent more than
// TX_LATE_SECONDS ago, `sentAt` in ms) or null without a hash. Polls only while `enabled`.
export function useAnswersTx(submitted, sentAt, enabled = true) {
  const hash = answersTxHash(submitted)
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
    hash && !mined && enabled ? TX_POLL_MS : null,
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

// The time left until `end` (ms) at `now` (ms), as the sidebar says it.
export function timeLeftText(t, end, now) {
  const {hours, minutes} = durationParts(Math.max(0, end - now) / 1000)
  if (hours === 0 && minutes < 1) return t('Under a minute left')
  if (hours === 0) return t('About {{minutes}} min left', {minutes})
  return t('About {{hours}} h {{minutes}} min left', {hours, minutes})
}

// The long answers' transaction from the saved validation (an xstate State: the machine's fields are in its
// context) of `epoch`, {hash, sentAt}; nulls when none was saved for it.
export function persistedLongAnswersTx(validationState, epoch) {
  const context =
    validationState?.context?.epoch === epoch ? validationState.context : null
  return {
    hash: context?.submitLongAnswersHash ?? null,
    sentAt: context?.submitLongAnswersAt ?? null,
  }
}

// What the screen after the submit says: `status` 'submitted' only once a block holds the answers, 'pending'
// while the node holds them, 'sent' when no transaction is known; `warning` 'noConnection' or 'late' while they
// are not in a block (a node that does not answer, `offline`, sends nothing either).
export function afterSubmitStatus({answersTx, connectionLost: lost, offline}) {
  if (answersTx === 'mined') return {status: 'submitted', warning: null}
  let warning = null
  if (lost || offline) warning = 'noConnection'
  else if (answersTx === 'late') warning = 'late'
  return {status: answersTx === null ? 'sent' : 'pending', warning}
}
