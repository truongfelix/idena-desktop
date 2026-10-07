/* eslint-disable react/prop-types */
import React from 'react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {useMachine} from '@xstate/react'
import {
  Heading,
  IconButton,
  List,
  ListItem,
  Stack,
  Text,
  useDisclosure,
} from '@chakra-ui/react'
import Layout from '../../shared/components/layout'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  ErrorAlert,
  Page,
  PageTitle,
  Tooltip,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {CrossSmallIcon} from '../../shared/components/icons'
import {rem} from '../../shared/theme'
import {createValidationMachine} from '../../screens/validation/machine'
import {ValidationScreen} from '../../screens/validation/screen'
import {
  useAutoStartLottery,
  useAutoStartValidation,
} from '../../screens/validation/hooks/use-start-validation'
import {availableReportsNumber} from '../../screens/validation/utils'
import {
  PRACTICE_LONG_SESSION_DURATION_PER_FLIP,
  PRACTICE_SHORT_SESSION_DURATION,
  createPractice,
  loadPracticeFlips,
  practiceNodeCalls,
  practiceResults,
  practiceServices,
} from '../../screens/validation/practice'

// The texts of the bad flip examples (BadFlipDialog), by report reason.
const REPORT_REASONS = {
  1: 'One of the keywords is not clearly visible in the images',
  2: 'Numbers or letters indicating the order',
  3: 'Sequence of enumerated objects',
  4: 'Text necessary to read to solve the flip',
  5: 'There is adult content (NSFW)',
  6: 'Several unrelated stories',
  7: 'Waking up template',
  8: 'Thumbs up/down image at the end',
  9: 'Images of both keywords are inserted into a page/screen/painting',
}

export default function PracticeValidationPage() {
  const router = useRouter()

  const [sample, setSample] = React.useState()
  const [loadError, setLoadError] = React.useState()

  React.useEffect(() => {
    let ignore = false
    loadPracticeFlips()
      .then((data) => {
        if (!ignore) setSample(data)
      })
      .catch((error) => {
        global.logger.error('Cannot read the practice flips', error?.message)
        if (!ignore) setLoadError(error)
      })
    return () => {
      ignore = true
    }
  }, [])

  const [step, setStep] = React.useState('intro')
  const [practice, setPractice] = React.useState()
  const [results, setResults] = React.useState()

  // Each practice orders the flips again and picks their sides again.
  const start = () => {
    setPractice(createPractice(sample))
    setStep('session')
  }

  if (step === 'session')
    return (
      <PracticeSession
        practice={practice}
        onDone={(context, didFail) => {
          setResults({...practiceResults(practice, context), didFail})
          setStep('results')
        }}
        onLeave={() => setStep('intro')}
      />
    )

  // The practice needs no node: its pages show while the node syncs or is offline.
  return (
    <Layout>
      <Page>
        {step === 'results' ? (
          <PracticeResults
            results={results}
            onAgain={start}
            onClose={() => router.push('/home')}
          />
        ) : (
          <PracticeIntro
            sample={sample}
            loadError={loadError}
            onStart={start}
          />
        )}
      </Page>
    </Layout>
  )
}

function PracticeIntro({sample, loadError, onStart}) {
  const {t} = useTranslation()

  const shortCount = sample?.short.length ?? 6
  const longCount = sample?.long.length ?? 9
  const reportCount = sample ? availableReportsNumber(sample.long) : 3

  return (
    <Stack spacing={6} maxW="xl">
      <PageTitle mb={0}>{t('Practice validation')}</PageTitle>
      <Text>
        {t(
          'The validation screens with the sample flips of the Idena web app. Nothing is sent and nothing is saved.'
        )}
      </Text>
      <Stack spacing={1}>
        <Heading as="h2" fontSize="lg" fontWeight={500}>
          {t('Short session')}
        </Heading>
        <Text>
          {t(
            '{{count}} flips in 2 minutes. For each flip, choose the story that makes sense.',
            {count: shortCount}
          )}
        </Text>
      </Stack>
      <Stack spacing={1}>
        <Heading as="h2" fontSize="lg" fontWeight={500}>
          {t('Long session')}
        </Heading>
        <Text>
          {t(
            '{{count}} flips, one minute each, right after the short session. Solve them, then check the keywords of each flip. Approve a good flip, or report it (up to {{reports}} flips) when a keyword is not in the story, numbers or letters show the order, it needs reading text, or it lists objects instead of telling a story. You can mark one approved flip as the best.',
            {count: longCount, reports: reportCount}
          )}
        </Text>
      </Stack>
      <Text color="muted">
        {t(
          'The results show the right stories and the flips to report. If the validation starts, it opens instead.'
        )}
      </Text>
      {loadError && (
        <ErrorAlert>{t('The sample flips cannot be read.')}</ErrorAlert>
      )}
      <PrimaryButton
        alignSelf="flex-start"
        isDisabled={!sample}
        isLoading={!sample && !loadError}
        onClick={onStart}
      >
        {t('Start the practice')}
      </PrimaryButton>
    </Stack>
  )
}

/** A practice session: its timer starts when it opens; nothing goes to the node and nothing is saved. */
function PracticeSession({practice, onDone, onLeave}) {
  const {t, i18n} = useTranslation()

  // A real validation comes first: its lottery and its session open as on the other pages.
  useAutoStartLottery()
  useAutoStartValidation()

  const longSessionDuration =
    practice.long.length * PRACTICE_LONG_SESSION_DURATION_PER_FLIP

  const [{validationStart, machine}] = React.useState(() => {
    const start = Date.now()
    return {
      validationStart: start,
      machine: createValidationMachine({
        epoch: 0,
        validationStart: start,
        shortSessionDuration: PRACTICE_SHORT_SESSION_DURATION,
        longSessionDuration,
        locale: i18n.language || 'en',
        nodeCalls: practiceNodeCalls(practice),
      }),
    }
  })

  const {
    isOpen: isExceededTooltipOpen,
    onOpen: onOpenExceededTooltip,
    onClose: onCloseExceededTooltip,
  } = useDisclosure()

  const leaveDisclosure = useDisclosure()

  const [state, send] = useMachine(machine, {
    services: practiceServices(practice),
    actions: {
      onExceededReports: () => {
        onOpenExceededTooltip()
        setTimeout(onCloseExceededTooltip, 3000)
      },
      onValidationSucceeded: () => {},
    },
    logger: global.isDev ? console.log : () => {},
  })

  React.useEffect(() => {
    if (state.done) onDone(state.context, state.matches('validationFailed'))
  }, [onDone, state])

  const isShortSession = state.matches('shortSession')

  return (
    <ValidationScreen
      state={state}
      send={send}
      validationStart={validationStart}
      shortSessionDuration={PRACTICE_SHORT_SESSION_DURATION}
      longSessionDuration={longSessionDuration}
      isExceededTooltipOpen={isExceededTooltipOpen}
      onCloseExceededTooltip={onCloseExceededTooltip}
      headerActions={
        <Tooltip label={t('Leave the practice')} placement="bottom-end">
          <IconButton
            aria-label={t('Leave the practice')}
            icon={<CrossSmallIcon />}
            bg={isShortSession ? 'brandGray.060' : 'gray.300'}
            color={isShortSession ? 'white' : 'brandGray.500'}
            borderRadius="lg"
            fontSize={rem(20)}
            w={10}
            h={10}
            ml={2}
            _hover={{
              bg: isShortSession ? 'brandGray.060' : 'gray.300',
            }}
            onClick={leaveDisclosure.onOpen}
          />
        </Tooltip>
      }
    >
      <Dialog
        title={t('Leave the practice?')}
        isOpen={leaveDisclosure.isOpen}
        onClose={leaveDisclosure.onClose}
      >
        <DialogBody>
          <Text>{t('The answers of this practice are lost.')}</Text>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={leaveDisclosure.onClose}>
            {t('Stay')}
          </SecondaryButton>
          <PrimaryButton onClick={onLeave}>{t('Leave')}</PrimaryButton>
        </DialogFooter>
      </Dialog>
    </ValidationScreen>
  )
}

function PracticeResults({results, onAgain, onClose}) {
  const {t} = useTranslation()

  const reason = (reportReason) => t(REPORT_REASONS[reportReason] ?? '')

  const storyText = {
    right: [t('Story right'), 'green.500'],
    wrong: [t('Story wrong'), 'red.500'],
    none: [t('Story not solved'), 'red.500'],
  }

  const checkText = ({check, reportReason}) =>
    ({
      approved: [t('Approved'), 'green.500'],
      reported: [
        t('Reported ({{reason}})', {reason: reason(reportReason)}),
        'green.500',
      ],
      shouldReport: [
        t('To report ({{reason}})', {reason: reason(reportReason)}),
        'red.500',
      ],
      shouldApprove: [t('A good flip, to approve'), 'red.500'],
      notChecked: [t('Keywords not checked'), 'red.500'],
    }[check])

  return (
    <Stack spacing={6} maxW="2xl">
      <PageTitle mb={0}>{t('Practice results')}</PageTitle>
      {results.didFail && (
        <ErrorAlert>
          {t(
            'Validation failed. Too few answers were given before the timer ran out.'
          )}
        </ErrorAlert>
      )}
      <Stack spacing={2}>
        <ResultRow label={t('Short session')}>
          {t('{{right}} of {{total}} stories right', results.short)}
        </ResultRow>
        <ResultRow label={t('Long session')}>
          {t('{{right}} of {{total}} stories right', results.long)}
        </ResultRow>
        <ResultRow label={t('Reports')}>
          {t(
            '{{reported}} of {{total}} flips to report ({{allowed}} reports allowed)',
            results.reports
          )}
        </ResultRow>
      </Stack>
      <Stack spacing={2}>
        <Heading as="h2" fontSize="lg" fontWeight={500}>
          {t('Long session, flip by flip')}
        </Heading>
        <List spacing={2}>
          {results.longFlips.map((flip, idx) => {
            const [check, checkColor] = checkText(flip)
            const [story, storyColor] = flip.story ? storyText[flip.story] : []
            return (
              <ListItem key={flip.hash}>
                <Text as="span" fontWeight={500}>
                  {idx + 1}. {flip.keywords.join(' / ')}
                </Text>
                {story && (
                  <Text as="span" color={storyColor}>
                    {' · '}
                    {story}
                  </Text>
                )}
                <Text as="span" color={checkColor}>
                  {' · '}
                  {check}
                </Text>
                {flip.isBest && (
                  <Text as="span" color="muted">
                    {' · '}
                    {t('Marked as the best')}
                  </Text>
                )}
              </ListItem>
            )
          })}
        </List>
      </Stack>
      <Stack isInline spacing={2}>
        <PrimaryButton onClick={onAgain}>{t('Practice again')}</PrimaryButton>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
      </Stack>
    </Stack>
  )
}

function ResultRow({label, children}) {
  return (
    <Stack isInline spacing={4}>
      <Text color="muted" w={40} flexShrink={0}>
        {label}
      </Text>
      <Text>{children}</Text>
    </Stack>
  )
}
