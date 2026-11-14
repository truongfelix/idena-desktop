/* eslint-disable react/prop-types */
import React, {useMemo, useEffect} from 'react'
import {useMachine} from '@xstate/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {useDisclosure} from '@chakra-ui/react'
import {createValidationMachine} from '../screens/validation/machine'
import {
  persistValidationState,
  loadValidationState,
  availableReportsNumber,
} from '../screens/validation/utils'
import {
  ValidationFailedDialog,
  SynchronizingValidationAlert,
  OfflineValidationAlert,
} from '../screens/validation/components'
import {
  ValidationScreen,
  agentPhase,
  autopilotStep,
  sessionFlips,
} from '../screens/validation/screen'
import {useAgentValidation} from '../screens/validation/agent/use-agent-validation'
import {useEpochState} from '../shared/providers/epoch-context'
import {useTimingState} from '../shared/providers/timing-context'
import {useChainState} from '../shared/providers/chain-context'
import {useAutoCloseValidationToast} from '../screens/validation/hooks/use-validation-toast'

export default function ValidationPage() {
  const epoch = useEpochState()
  const timing = useTimingState()

  useAutoCloseValidationToast()

  if (epoch && timing && timing.shortSession)
    return (
      <ValidationSession
        epoch={epoch.epoch}
        validationStart={new Date(epoch.nextValidation).getTime()}
        shortSessionDuration={timing.shortSession}
        longSessionDuration={timing.longSession}
      />
    )

  return null
}

function ValidationSession({
  epoch,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
}) {
  const router = useRouter()

  const {t, i18n} = useTranslation()

  const {
    isOpen: isExceededTooltipOpen,
    onOpen: onOpenExceededTooltip,
    onClose: onCloseExceededTooltip,
  } = useDisclosure()

  const validationMachine = useMemo(
    () =>
      createValidationMachine({
        epoch,
        validationStart,
        shortSessionDuration,
        longSessionDuration,
        locale: i18n.language || 'en',
      }),
    [
      epoch,
      i18n.language,
      longSessionDuration,
      shortSessionDuration,
      validationStart,
    ]
  )

  const [state, send] = useMachine(validationMachine, {
    actions: {
      onExceededReports: () => {
        onOpenExceededTooltip()
        setTimeout(onCloseExceededTooltip, 3000)
      },
      onValidationSucceeded: () => {
        router.push('/validation/after')
      },
    },
    state: loadValidationState(),
    logger: global.isDev
      ? console.log
      : (...args) => global.logger.debug(...args),
  })

  useEffect(() => {
    persistValidationState(state)
  }, [state])

  const {syncing, offline} = useChainState()

  // The agent, when it is on (the validation agent, in Agents): Suggest or Autopilot, as the practice showed it.
  const agent = useAgentValidation({
    flips: sessionFlips(state),
    phase: agentPhase(state),
    reportsUsed: state.context.reports.size,
    // The machine's own limit: every long flip counts, ready or not.
    reportsAllowed: availableReportsNumber(state.context.longFlips),
    step: autopilotStep(state),
    send,
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  })

  return (
    <ValidationScreen
      state={state}
      send={send}
      validationStart={validationStart}
      shortSessionDuration={shortSessionDuration}
      longSessionDuration={longSessionDuration}
      isExceededTooltipOpen={isExceededTooltipOpen}
      onCloseExceededTooltip={onCloseExceededTooltip}
      agent={agent}
    >
      {syncing && (
        <SynchronizingValidationAlert>
          {t('Synchronizing...')}
        </SynchronizingValidationAlert>
      )}

      {offline && (
        <OfflineValidationAlert>{t('Offline')}</OfflineValidationAlert>
      )}

      {state.matches('validationFailed') && (
        <ValidationFailedDialog isOpen onSubmit={() => router.push('/home')} />
      )}
    </ValidationScreen>
  )
}
