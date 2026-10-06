import {HASH_IN_MEMPOOL} from '../../shared/utils/utils'
import {
  TxStatus,
  hasPayload,
  hasReceipt,
  isInMempool,
  transactionStatus,
} from './utils'

const BLOCK_HASH =
  '0x8c4be2a1f2e0d0d5a0c4f9ab3b3c11e3d4d1a2b3c4d5e6f708192a3b4c5d6e7f'

describe('transactionStatus', () => {
  it('is unknown when the node returned nothing', () => {
    expect(transactionStatus(null)).toBe(TxStatus.Unknown)
    expect(transactionStatus(undefined)).toBe(TxStatus.Unknown)
  })

  it('is mining while the block hash is the empty one', () => {
    expect(transactionStatus({blockHash: HASH_IN_MEMPOOL})).toBe(
      TxStatus.Mining
    )
  })

  it('is confirmed in a block without a receipt', () => {
    expect(transactionStatus({blockHash: BLOCK_HASH})).toBe(TxStatus.Confirmed)
    expect(transactionStatus({blockHash: BLOCK_HASH}, null)).toBe(
      TxStatus.Confirmed
    )
  })

  it('follows the receipt of a contract call', () => {
    expect(transactionStatus({blockHash: BLOCK_HASH}, {success: true})).toBe(
      TxStatus.Confirmed
    )
    expect(
      transactionStatus(
        {blockHash: BLOCK_HASH},
        {success: false, error: 'out of gas'}
      )
    ).toBe(TxStatus.Failed)
  })

  it('stays mining when a receipt arrives for a mempool transaction', () => {
    expect(
      transactionStatus({blockHash: HASH_IN_MEMPOOL}, {success: false})
    ).toBe(TxStatus.Mining)
  })
})

describe('isInMempool', () => {
  it('treats a missing block hash as the mempool', () => {
    expect(isInMempool({})).toBe(true)
    expect(isInMempool({blockHash: HASH_IN_MEMPOOL})).toBe(true)
    expect(isInMempool({blockHash: BLOCK_HASH})).toBe(false)
  })
})

describe('hasReceipt', () => {
  it('is true for contract transactions only', () => {
    expect(hasReceipt('callContract')).toBe(true)
    expect(hasReceipt('deployContract')).toBe(true)
    expect(hasReceipt('terminateContract')).toBe(true)
    expect(hasReceipt('send')).toBe(false)
    expect(hasReceipt('kill')).toBe(false)
    expect(hasReceipt(undefined)).toBe(false)
  })
})

describe('hasPayload', () => {
  it('is false for an empty payload', () => {
    expect(hasPayload('0x')).toBe(false)
    expect(hasPayload(null)).toBe(false)
    expect(hasPayload(undefined)).toBe(false)
    expect(hasPayload('0x0a1b')).toBe(true)
  })
})
