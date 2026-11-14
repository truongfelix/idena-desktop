import {
  Box,
  Center,
  CloseButton,
  Flex,
  Heading,
  Stack,
  Text,
} from '@chakra-ui/react'
import dayjs from 'dayjs'
import NextLink from 'next/link'
import {useRouter} from 'next/router'
import React from 'react'
import {useTranslation} from 'react-i18next'
import {ValidationAdPromotion} from '../../screens/validation/components/ads'
import {ValidationCountdown} from '../../screens/validation/components/countdown'
import {usePersistedValidationState} from '../../screens/validation/hooks/use-persisted-state'
import {
  useAutoCloseValidationToast,
  useTrackEpochPeriod,
} from '../../screens/validation/hooks/use-validation-toast'
import {canValidate} from '../../screens/validation/utils'
import {
  afterSubmitStatus,
  persistedLongAnswersTx,
  timeLeftText,
  useAnswersTx,
  useNodeConnection,
} from '../../screens/validation/connection'
import {ErrorAlert} from '../../shared/components/components'
import {Status} from '../../shared/components/sidebar'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useIdentity} from '../../shared/providers/identity-context'
import {useTimingState} from '../../shared/providers/timing-context'
import {EpochPeriod, IdentityStatus} from '../../shared/types'

export default function AfterValidationPage() {
  const {t} = useTranslation()

  const router = useRouter()

  const {data: validationState} = usePersistedValidationState()

  // Success only once a block holds the answers: a node without peers keeps them in its pool (B-244).
  const longAnswers = persistedLongAnswersTx(validationState)
  const answersTx = useAnswersTx(longAnswers.hash, longAnswers.sentAt)
  const {lost: connectionLost} = useNodeConnection()
  const {status, warning} = afterSubmitStatus({answersTx, connectionLost})

  const epoch = useEpochState()
  const currentPeriod = epoch?.currentPeriod

  const isAfterLongSession = currentPeriod === EpochPeriod.AfterLongSession
  const isValidationCeremony = [
    EpochPeriod.ShortSession,
    EpochPeriod.LongSession,
  ].includes(currentPeriod)

  const timing = useTimingState()

  const [identity] = useIdentity()

  const isEligible = canValidate(identity)

  const isValidated = [
    IdentityStatus.Newbie,
    IdentityStatus.Verified,
    IdentityStatus.Human,
  ].includes(identity.state)

  const validationEnd = dayjs(epoch?.nextValidation)
    .add(timing?.shortSession, 'second')
    .add(timing?.longSession, 'second')

  useAutoCloseValidationToast()

  useTrackEpochPeriod({
    onChangeCurrentPeriod: (period) => {
      if ([EpochPeriod.None, EpochPeriod.FlipLottery].includes(period)) {
        router.push('/home')
      }
    },
  })

  return (
    <Box
      bg="graphite.500"
      color="white"
      fontSize="md"
      p={['8', 0]}
      pt={['2', 0]}
      position="relative"
      w="full"
    >
      <Flex
        justifyContent="space-between"
        alignItems="center"
        position={['relative', 'absolute']}
        insetX={[0, '4']}
        top={[null, '2']}
        mx={['-4', 0]}
        mb={['8', 0]}
      >
        <Status />
        {/* Replaces the closed screen: the way back from Home does not reopen it. */}
        <NextLink href="/home" passHref replace>
          <CloseButton boxSize={4} color="white" />
        </NextLink>
      </Flex>

      <Center color="white" minH="100vh">
        <Stack spacing="12" w={['xs', '640px']}>
          <Stack spacing="6">
            <Stack spacing="2">
              <Heading fontSize="lg" fontWeight={500}>
                {isAfterLongSession
                  ? t('Waiting for the Idena validation results')
                  : t('Waiting for the end of the long session')}
              </Heading>

              {isAfterLongSession && (
                <Text color="xwhite.050" fontSize="mdx">
                  {t('Network is reaching consensus on validated identities')}
                </Text>
              )}

              {isValidationCeremony && isEligible && (
                <Text color="xwhite.050" fontSize="mdx">
                  {status === 'submitted' &&
                    t('Your answers are successfully submitted')}
                  {status === 'pending' &&
                    t('Please wait. Your answers are being submitted...')}
                  {status === 'sent' &&
                    t('Your answers were sent to your node')}
                </Text>
              )}
            </Stack>
            {isAfterLongSession ? null : (
              <ValidationCountdown duration={validationEnd.diff(dayjs())} />
            )}

            {isValidationCeremony && isEligible && warning && (
              <ErrorAlert>
                {`${
                  warning === 'noConnection'
                    ? t(
                        'Your node has no connection: your answers cannot reach the network',
                        {nsSeparator: '|'}
                      )
                    : t(
                        'Your answers are not in a block yet: keep the app open and connected',
                        {nsSeparator: '|'}
                      )
                } (${timeLeftText(t, validationEnd.valueOf(), Date.now())})`}
              </ErrorAlert>
            )}

            {!isEligible && (
              <ErrorAlert>
                {isValidated
                  ? t(
                      'Can not start validation session because you did not submit flips'
                    )
                  : t(
                      'Can not start validation session because you did not activate invite'
                    )}
              </ErrorAlert>
            )}
          </Stack>
          <ValidationAdPromotion />
        </Stack>
      </Center>
    </Box>
  )
}
