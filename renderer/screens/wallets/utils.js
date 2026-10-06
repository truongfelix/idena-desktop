import {HASH_IN_MEMPOOL} from '../../shared/utils/utils'

// The transaction details drawer: a transaction as the own node returns it (bcn_transaction, bcn_block and, for
// contract transactions, bcn_txReceipt).

export const TxStatus = {
  // The node returned nothing for the hash (never seen, or dropped from the mempool).
  Unknown: 'unknown',
  Mining: 'mining',
  Confirmed: 'confirmed',
  // In a block, but the contract call failed (its receipt says so).
  Failed: 'failed',
}

const receiptTypes = ['callContract', 'deployContract', 'terminateContract']

// Only contract transactions have a receipt: a node before idena-go #19 fails bcn_txReceipt for the others.
export function hasReceipt(type) {
  return receiptTypes.includes(type)
}

export function isInMempool(tx) {
  return !tx?.blockHash || tx.blockHash === HASH_IN_MEMPOOL
}

export function transactionStatus(tx, receipt) {
  if (!tx) return TxStatus.Unknown
  if (isInMempool(tx)) return TxStatus.Mining
  if (receipt && !receipt.success) return TxStatus.Failed
  return TxStatus.Confirmed
}

export function hasPayload(payload) {
  return Boolean(payload) && payload !== '0x'
}
