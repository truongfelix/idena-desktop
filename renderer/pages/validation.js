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
} from '../screens/validation/utils'
import {
  ValidationFailedDialog,
  SynchronizingValidationAlert,
  OfflineValidationAlert,
} from '../screens/validation/components'
import {ValidationScreen} from '../screens/validation/screen'
import {useEpochState} from '../shared/providers/epoch-context'
import {useTimingState} from '../shared/providers/timing-context'
import {useChainState} from '../shared/providers/chain-context'
import {useAutoCloseValidationToast} from '../screens/validation/hooks/use-validation-toast'
import {
  timeLeftText,
  useAnswersTx,
  useNodeConnection,
} from '../screens/validation/connection'

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

  // The answers go out through the node: with no peer, or a head that does not move, they reach no one (B-244).
  const {lost: connectionLost} = useNodeConnection()
  const shortAnswersTx = useAnswersTx(
    state.context.submitShortAnswersHash,
    state.context.submitShortAnswersAt
  )
  const validationEnd =
    validationStart + (shortSessionDuration + longSessionDuration) * 1000

  return (
    <ValidationScreen
      state={state}
      send={send}
      validationStart={validationStart}
      shortSessionDuration={shortSessionDuration}
      longSessionDuration={longSessionDuration}
      isExceededTooltipOpen={isExceededTooltipOpen}
      onCloseExceededTooltip={onCloseExceededTooltip}
    >
      {syncing && (
        <SynchronizingValidationAlert>
          {t('Synchronizing...')}
        </SynchronizingValidationAlert>
      )}

      {offline && (
        <OfflineValidationAlert>{t('Offline')}</OfflineValidationAlert>
      )}

      {!offline && !syncing && connectionLost && (
        <OfflineValidationAlert>
          {t(
            'Your node has no connection: your answers cannot reach the network',
            {nsSeparator: '|'}
          )}
        </OfflineValidationAlert>
      )}

      {!offline &&
        !syncing &&
        !connectionLost &&
        shortAnswersTx === 'late' &&
        state.matches('longSession') && (
          <SynchronizingValidationAlert>
            {`${t(
              'Your short answers are not in a block yet: keep the app open and connected',
              {nsSeparator: '|'}
            )} (${timeLeftText(t, validationEnd, Date.now())})`}
          </SynchronizingValidationAlert>
        )}

      {state.matches('validationFailed') && (
        <ValidationFailedDialog isOpen onSubmit={() => router.push('/home')} />
      )}
    </ValidationScreen>
  )
}
