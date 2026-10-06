import * as React from 'react'
import {useDisclosure} from '@chakra-ui/react'
import {useQuery} from 'react-query'
import {callRpc} from '../../shared/utils/utils'
import {BLOCK_TIME} from '../oracles/utils'
import {hasReceipt, isInMempool, transactionStatus} from './utils'

// A transaction from the own node: re-read every half block while it waits in the mempool, then its block and,
// for a contract transaction, its receipt.
export function useTransactionDetails(hash, {enabled = true} = {}) {
  const {
    data: tx,
    isLoading,
    isError,
    error,
  } = useQuery(
    ['bcn_transaction', hash],
    () => callRpc('bcn_transaction', hash),
    {
      enabled: Boolean(hash) && enabled,
      refetchInterval: (data) =>
        data && isInMempool(data) ? (BLOCK_TIME / 2) * 1000 : false,
      notifyOnChangeProps: 'tracked',
    }
  )

  const isMined = Boolean(tx) && !isInMempool(tx)

  const {data: block} = useQuery(
    ['bcn_block', tx?.blockHash],
    () => callRpc('bcn_block', tx.blockHash),
    {
      enabled: enabled && isMined,
      staleTime: Infinity,
      notifyOnChangeProps: 'tracked',
    }
  )

  const withReceipt = isMined && hasReceipt(tx?.type)

  const {data: receipt, isLoading: isLoadingReceipt} = useQuery(
    ['bcn_txReceipt', hash],
    () => callRpc('bcn_txReceipt', hash),
    {
      enabled: enabled && withReceipt,
      staleTime: Infinity,
      notifyOnChangeProps: 'tracked',
    }
  )

  return {
    tx,
    block,
    receipt,
    // No status while the receipt that can turn it into Failed is on its way.
    status:
      withReceipt && isLoadingReceipt ? null : transactionStatus(tx, receipt),
    isLoading,
    isError,
    error,
  }
}

// Open state for a list's details drawer: the hash stays set while the drawer closes.
export function useTransactionDetailsDrawer() {
  const [hash, setHash] = React.useState()
  const {isOpen, onOpen, onClose} = useDisclosure()

  const open = React.useCallback(
    (value) => {
      setHash(value)
      onOpen()
    },
    [onOpen]
  )

  return {open, drawerProps: {hash, isOpen, onClose}}
}
