import {useInfiniteQuery, useQuery} from 'react-query'
import {strip} from '../../shared/utils/obj'
import {callRpc} from '../../shared/utils/utils'

// dna_identityHistory: polled every few seconds while the node is still looking for its ceremony blocks (the first
// start after the update reads every stored header once, about a minute).
export function useIdentityHistory(address, {enabled = true} = {}) {
  return useQuery(
    ['dna_identityHistory', address],
    () => callRpc('dna_identityHistory', address),
    {
      enabled: Boolean(address) && enabled,
      refetchInterval: (data) =>
        data && !data.ceremoniesComplete ? 5 * 1000 : 60 * 1000,
      notifyOnChangeProps: 'tracked',
    }
  )
}

export const TRANSACTIONS_PAGE = 30

// bcn_transactions, page by page (the node keeps its own addresses' transactions).
export function useTransactionPages(address, {enabled = true} = {}) {
  return useInfiniteQuery(
    ['bcn_transactions', address],
    ({pageParam}) =>
      callRpc(
        'bcn_transactions',
        strip({address, count: TRANSACTIONS_PAGE, token: pageParam})
      ),
    {
      enabled: Boolean(address) && enabled,
      getNextPageParam: (page) => page?.token ?? undefined,
      notifyOnChangeProps: 'tracked',
    }
  )
}
