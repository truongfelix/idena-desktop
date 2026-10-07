import React, {useEffect, useState} from 'react'
import {useMutation, useQuery} from 'react-query'
import {useIdentityState} from '../../shared/providers/identity-context'
import {calculateInvitationRewardRatio, callRpc} from '../../shared/utils/utils'
import {IdentityStatus, TxType} from '../../shared/types'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useChainState} from '../../shared/providers/chain-context'
import {apy, fetchNetworkRewards} from './apy'

const COMMUNITY_ALERT_CLOSED = 'didCloseCommunityAlert'

/** Whether the user closed Home's community links ([closed, close]); closing is kept for good. */
export function useCommunityAlert() {
  const [closed, setClosed] = useState(true)

  useEffect(() => {
    try {
      setClosed(localStorage.getItem(COMMUNITY_ALERT_CLOSED) === 'true')
    } catch {
      setClosed(false)
    }
  }, [])

  return [
    closed,
    () => {
      try {
        localStorage.setItem(COMMUNITY_ALERT_CLOSED, 'true')
      } catch {
        // Not kept: the links show again at the next start.
      }
      setClosed(true)
    },
  ]
}

export function useReplenishStake({onSuccess, onError}) {
  const {address} = useIdentityState()

  const mutation = useMutation(
    async ({amount}) =>
      callRpc('dna_sendTransaction', {
        type: TxType.ReplenishStakeTx,
        from: address,
        to: address,
        amount,
      }),
    {
      onSuccess,
      onError,
    }
  )

  return {
    data: mutation.data,
    submit: mutation.mutate,
  }
}

/**
 * The APY of the identity's stake (a fraction), from the node's own data (./apy.js): staking and mining if
 * the identity validates and mines itself; flip and invitation rewards are not counted. Read every 10
 * minutes once the node is synced.
 */
export function useStakingApy() {
  const {stake} = useIdentityState()

  const {offline, syncing} = useChainState()

  const {data: network} = useQuery({
    queryKey: ['network-rewards'],
    queryFn: () => fetchNetworkRewards(callRpc),
    enabled: !offline && !syncing,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    notifyOnChangeProps: 'tracked',
  })

  return React.useMemo(
    () => apy(Number(stake), network)?.yearly,
    [network, stake]
  )
}

export function useInviteScore() {
  const {highestBlock} = useChainState()

  const epoch = useEpochState()

  const {canInvite, invitees} = useIdentityState()

  const inviteesAddresses = (invitees || []).map((x) => x.Address)

  const {data: hasNotActivatedInvite} = useQuery({
    queryKey: ['invitesStatuses', ...inviteesAddresses],
    queryFn: () =>
      Promise.all(
        inviteesAddresses.map((addr) => callRpc('dna_identity', addr))
      ),
    select: React.useCallback(
      (data) => data.some((x) => x.state === IdentityStatus.Invite),
      []
    ),
  })

  return React.useMemo(() => {
    if (epoch && highestBlock && (canInvite || hasNotActivatedInvite)) {
      return calculateInvitationRewardRatio(epoch, {highestBlock})
    }
  }, [canInvite, epoch, hasNotActivatedInvite, highestBlock])
}
