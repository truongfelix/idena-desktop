import {useMachine} from '@xstate/react'
import React from 'react'
import {useEpochState} from '../../../shared/providers/epoch-context'
import {useIdentity} from '../../../shared/providers/identity-context'
import {validationReportMachine} from './machines'

// Score over the identity's last validations; undefined before any flip counted.
export function useTotalValidationScore() {
  const [{totalShortFlipPoints, totalQualifiedFlips}] = useIdentity()
  return totalQualifiedFlips
    ? Math.min(totalShortFlipPoints / totalQualifiedFlips, 1)
    : undefined
}

// The report of the last ceremony, or of reportEpoch's.
export function useValidationReportSummary(reportEpoch) {
  const [identity] = useIdentity()

  const epoch = useEpochState()

  const totalScore = useTotalValidationScore()

  const [current, send] = useMachine(validationReportMachine)

  React.useEffect(() => {
    if (epoch && identity?.address)
      send('FETCH', {
        epochNumber: reportEpoch ?? epoch.epoch - 1,
        identity,
      })
  }, [epoch, identity, reportEpoch, send])

  return {
    ...current.context,
    totalScore,
    isLoading: current.matches('idle') || current.matches('fetching'),
  }
}
