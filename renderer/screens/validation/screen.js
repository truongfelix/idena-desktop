/* eslint-disable react/prop-types */
import React, {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {
  Flex,
  Text,
  IconButton,
  Heading,
  Stack,
  Button,
  Divider,
  SlideFade,
  useDisclosure,
} from '@chakra-ui/react'
import {
  filterRegularFlips,
  rearrangeFlips,
  readyFlip,
  decodedWithKeywords,
  availableReportsNumber,
  solvableFlips,
} from './utils'
import {
  ValidationScene,
  ActionBar,
  ThumbnailList,
  Header,
  Title,
  FlipChallenge,
  CurrentStep,
  Flip,
  ActionBarItem,
  Thumbnail,
  FlipWords,
  NavButton,
  QualificationActions,
  QualificationButton,
  WelcomeQualificationDialog,
  ValidationTimer,
  SubmitFailedDialog,
  FailedFlipAnnotation,
  ReviewValidationDialog,
  EncourageReportDialog,
  BadFlipDialog,
  ReviewShortSessionDialog,
} from './components'
import {rem} from '../../shared/theme'
import {AGENT_COLORS, pickedSide} from './agent/picks'
import {SubmitCountdown} from './agent/submit-countdown'
import {AnswerType, RelevanceType} from '../../shared/types'
import {InfoButton, PrimaryButton} from '../../shared/components/button'
import {FloatDebug, Tooltip} from '../../shared/components/components'
import {useQuitQuestionOpen} from '../../shared/components/confirm-quit'
import {
  FullscreenIcon,
  HollowStarIcon,
  NewStarIcon,
} from '../../shared/components/icons'

/**
 * The screens of a validation session, driven by a validation machine's `state` and `send`: the validation and its
 * practice. `children` come first in the scene (alerts, the page's own dialogs), `headerActions` after the full
 * screen button.
 */
export function ValidationScreen({
  state,
  send,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
  isExceededTooltipOpen,
  onCloseExceededTooltip,
  headerActions,
  agent,
  children,
}) {
  const {t} = useTranslation()

  const isQuitQuestionOpen = useQuitQuestionOpen()

  const {
    isOpen: isReportDialogOpen,
    onOpen: onOpenReportDialog,
    onClose: onCloseReportDialog,
  } = useDisclosure()

  const {
    currentIndex,
    bestFlipHashes,
    translations,
    reports,
    longFlips,
    didReport,
  } = state.context

  const {
    isOpen: isOpenEncourageReportDialog,
    onOpen: onOpenEncourageReportDialog,
    onClose: onCloseEncourageReportDialog,
  } = useDisclosure()

  React.useEffect(() => {
    if (didReport) onOpenEncourageReportDialog()
  }, [didReport, onOpenEncourageReportDialog])

  const flips = sessionFlips(state)
  const currentFlip = flips[currentIndex]

  const agentColor = isShortSession(state)
    ? AGENT_COLORS.dark
    : AGENT_COLORS.themed

  // The agent's pick on this flip, on the side it picked: in Suggest until the person answers; in the keywords
  // check, a report it leaves to the person (Suggest, or Autopilot with reports on Ask me) until the flip is marked.
  const pick = agent && currentFlip ? agent.picks[currentFlip.hash] : null
  const agentPickFor = (variant) => {
    if (!pick) return null
    const isKeywords = isLongSessionKeywords(state)
    // A report shows on the reporting agent's side (B-257: another agent, or no answer); an answer on its own.
    const side = isKeywords
      ? pickedSide({answer: pick.reportSide ?? pick.answer})
      : pickedSide(pick)
    // The flip it would mark best (B-260), shown for the person's click; on the left when the agent took no side.
    const best = isKeywords && agent.bestSuggestion === currentFlip.hash
    if (side !== variant && !(best && !side && variant === AnswerType.Left))
      return null
    const show = isKeywords
      ? best ||
        (Boolean(pick.report) &&
          !currentFlip.relevance &&
          // A report the agent makes alone is made, not shown (B-257: whatever the answering agent's mode).
          pick.reportDecision !== 'alone')
      : agent.mode === 'suggest' &&
        pick.answers !== false &&
        !currentFlip.option
    return show
      ? {
          percent: Math.round((pick.confidence || 0) * 100),
          report: isKeywords && !best,
          best,
          isDark: isShortSession(state),
        }
      : null
  }

  const flipTimerDetails = {
    isShortSession: isShortSession(state),
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  }

  const [bestRewardTipOpen, setBestRewardTipOpen] = useState(false)
  useEffect(() => {
    if (currentFlip && currentFlip.relevance === RelevanceType.Relevant) {
      setBestRewardTipOpen(true)
    }
  }, [currentFlip])
  useEffect(() => {
    if (bestFlipHashes[currentFlip?.hash]) {
      setBestRewardTipOpen(false)
    }
  }, [bestFlipHashes, currentFlip])
  useEffect(() => {
    if (bestRewardTipOpen) {
      setTimeout(() => {
        setBestRewardTipOpen(false)
      }, 5000)
    }
  }, [bestRewardTipOpen, currentFlip])

  return (
    <ValidationScene bg={isShortSession(state) ? 'black' : 'surface'}>
      {children}

      <Header>
        <Title color={isShortSession(state) ? 'white' : 'brandGray.500'}>
          {['shortSession', 'longSession'].some(state.matches) &&
          !isLongSessionKeywords(state)
            ? t('Select meaningful story: left or right', {nsSeparator: '!'})
            : t('Check flips quality')}
        </Title>
        <Flex align="center">
          <Title
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            mr={6}
          >
            {currentIndex + 1}{' '}
            <Text as="span" color="muted">
              {t('out of')} {flips.length}
            </Text>
          </Title>

          {agent && (
            <Flex
              align="center"
              gap={2}
              mr={2}
              pl={3}
              pr={1}
              py={1}
              borderRadius="md"
              borderWidth={1}
              borderColor={agentColor}
              color={agentColor}
              fontSize="sm"
            >
              <Text>{agentBadgeText(agent, t)}</Text>
              {/* A person supervises: pauses the agent, corrects, and resumes it. */}
              <Button
                size="xs"
                variant="outline"
                borderColor={agentColor}
                color={agentColor}
                _hover={{bg: 'transparent'}}
                onClick={agent.paused ? agent.resume : agent.pause}
              >
                {agent.paused ? t('Resume') : t('Pause')}
              </Button>
            </Flex>
          )}
          <IconButton
            icon={<FullscreenIcon />}
            bg={isShortSession(state) ? 'brandGray.060' : 'gray.300'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            borderRadius="lg"
            fontSize={rem(20)}
            w={10}
            h={10}
            _hover={{
              bg: isShortSession(state) ? 'brandGray.060' : 'gray.300',
            }}
            onClick={global.toggleFullScreen}
          />
          {headerActions}
        </Flex>
      </Header>
      <CurrentStep>
        <FlipChallenge>
          <Flex justify="center" align="center" position="relative">
            {currentFlip &&
              ((currentFlip.fetched && !currentFlip.decoded) ||
                currentFlip.failed) && (
                <FailedFlipAnnotation>
                  {t('No data available. Please skip the flip.')}
                </FailedFlipAnnotation>
              )}
            <Flip
              {...currentFlip}
              variant={AnswerType.Left}
              timerDetails={flipTimerDetails}
              agentPick={agentPickFor(AnswerType.Left)}
              onChoose={(hash) =>
                send({
                  type: 'ANSWER',
                  hash,
                  option: AnswerType.Left,
                })
              }
            />
            <Flip
              {...currentFlip}
              variant={AnswerType.Right}
              timerDetails={flipTimerDetails}
              agentPick={agentPickFor(AnswerType.Right)}
              onChoose={(hash) =>
                send({
                  type: 'ANSWER',
                  hash,
                  option: AnswerType.Right,
                })
              }
              onImageFail={() => send('REFETCH_FLIPS')}
            />
          </Flex>
          {(isLongSessionKeywords(state) ||
            state.matches('validationSucceeded')) &&
            currentFlip && (
              <FlipWords
                key={currentFlip.hash}
                currentFlip={currentFlip}
                translations={translations}
                validationStart={validationStart}
                onSkip={() => {
                  if (isLastFlip(state)) {
                    send({type: 'SUBMIT'})
                  } else {
                    send({type: 'NEXT'})
                  }
                }}
              >
                <Stack spacing={4}>
                  <Stack isInline spacing={1} align="center">
                    <Heading fontSize="base" fontWeight={500}>
                      {t(`Is the flip correct?`)}
                    </Heading>
                    <InfoButton onClick={onOpenReportDialog} />
                  </Stack>
                  <QualificationActions>
                    <QualificationButton
                      isSelected={
                        currentFlip.relevance === RelevanceType.Relevant
                      }
                      onClick={() => {
                        onCloseExceededTooltip()
                        send({
                          type: 'APPROVE_WORDS',
                          hash: currentFlip.hash,
                        })
                      }}
                    >
                      {t('Approve')}
                    </QualificationButton>

                    <Tooltip
                      label={t(
                        'All available reports are used. You can skip this flip or remove Report status from other flips.'
                      )}
                      isOpen={isExceededTooltipOpen}
                      placement="top"
                      zIndex="tooltip"
                    >
                      <QualificationButton
                        isSelected={
                          currentFlip.relevance === RelevanceType.Irrelevant
                        }
                        bg={
                          currentFlip.relevance === RelevanceType.Irrelevant
                            ? 'red.500'
                            : 'red.012'
                        }
                        color={
                          currentFlip.relevance === RelevanceType.Irrelevant
                            ? 'white'
                            : 'red.500'
                        }
                        _hover={null}
                        _active={null}
                        _focus={{
                          boxShadow: '0 0 0 3px rgb(255 102 102 /0.50)',
                          outline: 'none',
                        }}
                        onClick={() =>
                          send({
                            type: 'REPORT_WORDS',
                            hash: currentFlip.hash,
                          })
                        }
                      >
                        {t('Report')}{' '}
                        {t('({{count}} left)', {
                          count:
                            availableReportsNumber(longFlips) - reports.size,
                        })}
                      </QualificationButton>
                    </Tooltip>
                  </QualificationActions>
                  <SlideFade
                    style={{
                      zIndex:
                        currentFlip.relevance === RelevanceType.Relevant &&
                        (Object.keys(bestFlipHashes).length < 1 ||
                          bestFlipHashes[currentFlip.hash])
                          ? 'auto'
                          : -1,
                    }}
                    offsetY="-80px"
                    in={
                      currentFlip.relevance === RelevanceType.Relevant &&
                      (Object.keys(bestFlipHashes).length < 1 ||
                        bestFlipHashes[currentFlip.hash])
                    }
                  >
                    <Divider mt={1} />
                    <Flex direction="column" align="center">
                      <Button
                        backgroundColor="transparent"
                        border="solid 1px #d2d4d9"
                        color="brandGray.500"
                        borderRadius={6}
                        mt={5}
                        variant="bordered"
                        w={['100%', 'auto']}
                        isActive={!!bestFlipHashes[currentFlip.hash]}
                        _hover={{
                          backgroundColor: 'transparent',
                          _disabled: {
                            backgroundColor: 'transparent',
                            color: '#DCDEDF',
                          },
                        }}
                        _active={{
                          backgroundColor: '#F5F6F7',
                        }}
                        onClick={() =>
                          send({
                            type: 'FAVORITE',
                            hash: currentFlip.hash,
                          })
                        }
                      >
                        {bestFlipHashes[currentFlip.hash] ? (
                          <NewStarIcon
                            h="12.5px"
                            w="13px"
                            mr="5.5px"
                            fill="brandGray.500"
                          />
                        ) : (
                          <HollowStarIcon
                            h="12.5px"
                            w="13px"
                            mr="5.5px"
                            fill="brandGray.500"
                          />
                        )}
                        {t('Mark as the best')}
                      </Button>
                      <Text fontSize="11px" color="#B8BABC" mt={2}>
                        {t('You can mark this flip as the best')}
                      </Text>
                    </Flex>
                  </SlideFade>
                </Stack>
              </FlipWords>
            )}
        </FlipChallenge>
      </CurrentStep>
      <ActionBar>
        <ActionBarItem>
          {agent?.noAnswer && isSolving(state) && !isSubmitting(state) && (
            <Stack spacing={0} mr={4} maxW="sm" fontSize="sm" color="red.500">
              {agent.noAnswer.reason && (
                <Text noOfLines={2}>
                  {t('No answer from the agent: {{reason}}', {
                    reason: agent.noAnswer.reason,
                    nsSeparator: '!!',
                    interpolation: {escapeValue: false},
                  })}
                </Text>
              )}
              <Text fontWeight={500}>{agentHelpText(agent, t)}</Text>
            </Stack>
          )}
          {agent?.canTakeRest && isSolving(state) && !isSubmitting(state) && (
            <Button
              variant="outline"
              borderColor={agentColor}
              color={agentColor}
              _hover={{bg: 'transparent'}}
              onClick={agent.takeRest}
            >
              {t("Take the agent's picks for the rest")}
            </Button>
          )}
          {Boolean(agent?.countdownEnd) && (
            <Flex align="center" gap={3}>
              <SubmitCountdown end={agent.countdownEnd}>
                {(seconds) => (
                  <Text color={agentColor} fontWeight={500}>
                    {t('The agent submits the answers in {{seconds}} s', {
                      seconds,
                    })}
                  </Text>
                )}
              </SubmitCountdown>
              <Button
                variant="outline"
                size="sm"
                borderColor={agentColor}
                color={agentColor}
                _hover={{bg: 'transparent'}}
                onClick={agent.pause}
              >
                {t('Pause the agent')}
              </Button>
            </Flex>
          )}
        </ActionBarItem>
        <ActionBarItem justify="center">
          <ValidationTimer
            validationStart={validationStart}
            duration={
              shortSessionDuration -
              10 +
              (isShortSession(state) ? 0 : longSessionDuration)
            }
          />
        </ActionBarItem>
        <ActionBarItem justify="flex-end">
          {(isShortSession(state) || isLongSessionKeywords(state)) &&
            (hasAllRelevanceMarks(state) || isLastFlip(state) ? (
              <PrimaryButton
                isDisabled={!canSubmit(state)}
                isLoading={isSubmitting(state)}
                loadingText={t('Submitting answers...')}
                onClick={() => send('SUBMIT')}
              >
                {t('Submit answers')}
              </PrimaryButton>
            ) : (
              <Tooltip label={t('Go to last flip')}>
                <PrimaryButton
                  isDisabled={!canSubmit(state)}
                  isLoading={isSubmitting(state)}
                  loadingText={t('Submitting answers...')}
                  onClick={() => send('SUBMIT')}
                >
                  {t('Submit answers')}
                </PrimaryButton>
              </Tooltip>
            ))}
          {isLongSessionFlips(state) && (
            <PrimaryButton
              isDisabled={!canSubmit(state)}
              onClick={() => send('FINISH_FLIPS')}
            >
              {t('Start checking keywords')}
            </PrimaryButton>
          )}
        </ActionBarItem>
      </ActionBar>

      <ThumbnailList currentIndex={currentIndex}>
        {flips.map((flip, idx) => (
          <Thumbnail
            key={flip.hash}
            {...flip}
            isCurrent={currentIndex === idx}
            isBest={bestFlipHashes[flip.hash]}
            onPick={() => send({type: 'PICK', index: idx})}
          />
        ))}
      </ThumbnailList>

      {!isFirstFlip(state) &&
        hasManyFlips(state) &&
        isSolving(state) &&
        !isSubmitting(state) && (
          <NavButton
            type="prev"
            bg={isShortSession(state) ? 'xwhite.010' : 'gray.50'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            onClick={() => send({type: 'PREV'})}
          />
        )}
      {!isLastFlip(state) &&
        hasManyFlips(state) &&
        isSolving(state) &&
        !isSubmitting(state) && (
          <NavButton
            type="next"
            bg={isShortSession(state) ? 'xwhite.010' : 'gray.50'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            onClick={() => send({type: 'NEXT'})}
          />
        )}
      {/* Hidden while the quit question shows: it would retry, open again over it and take the focus. */}
      {showsSubmitFailed(state, isQuitQuestionOpen) && (
        <SubmitFailedDialog isOpen onSubmit={() => send('RETRY_SUBMIT')} />
      )}

      {state.matches('longSession.solve.answer.welcomeQualification') && (
        <WelcomeQualificationDialog
          isOpen
          onSubmit={() => send('START_LONG_SESSION')}
        />
      )}

      <BadFlipDialog
        isOpen={
          isReportDialogOpen ||
          state.matches('longSession.solve.answer.finishFlips')
        }
        title={t('Earn rewards for reporting')}
        subtitle={t(
          'Report bad flips and get rewarded if these flips are reported by more than 50% of other participants'
        )}
        onClose={() => {
          if (state.matches('longSession.solve.answer.finishFlips'))
            send('START_KEYWORDS_QUALIFICATION')
          else onCloseReportDialog()
        }}
      />

      <ReviewValidationDialog
        flips={flips.filter(solvableFlips)}
        reportedFlipsCount={reports.size}
        availableReportsCount={availableReportsNumber(longFlips)}
        isOpen={state.matches('longSession.solve.answer.review')}
        isSubmitting={isSubmitting(state)}
        onSubmit={() => send('SUBMIT')}
        onMisingAnswers={() => {
          send({
            type: 'CHECK_FLIPS',
            index: flips.findIndex(({option = 0}) => option < 1),
          })
        }}
        onMisingReports={() => {
          send('CHECK_REPORTS')
        }}
        onCancel={() => {
          send('CANCEL')
        }}
      />

      <ReviewShortSessionDialog
        flips={flips.filter(solvableFlips)}
        isOpen={state.matches(
          'shortSession.solve.answer.submitShortSession.confirm'
        )}
        onSubmit={() => send('SUBMIT')}
        onClose={() => {
          send('CANCEL')
        }}
        onCancel={() => {
          send('CANCEL')
        }}
      />

      <EncourageReportDialog
        isOpen={isOpenEncourageReportDialog}
        onClose={onCloseEncourageReportDialog}
      />

      {global.isDev && <FloatDebug>{state.value}</FloatDebug>}
    </ValidationScene>
  )
}

const AUTOPILOT_STEPS = [
  ['shortSession.solve.answer.normal', 'short'],
  ['shortSession.solve.answer.submitShortSession.confirm', 'shortConfirm'],
  ['shortSession.solve.answer.submitShortSession.fail', 'shortFail'],
  ['longSession.solve.answer.welcomeQualification', 'welcome'],
  ['longSession.solve.answer.flips', 'long'],
  ['longSession.solve.answer.finishFlips', 'finish'],
  ['longSession.solve.answer.keywords', 'keywords'],
  ['longSession.solve.answer.review', 'review'],
  ['longSession.solve.answer.submitLongSession.fail', 'longFail'],
]

/** The agent's badge on the validation screen: paused, giving no answer, or its mode. */
function agentBadgeText(agent, t) {
  if (agent.paused) return t('Agent: paused', {nsSeparator: '!!'})
  if (agent.noAnswer) return t('Agent: no answer', {nsSeparator: '!!'})
  if (agent.mode === 'report') return t('Agent: reports', {nsSeparator: '!!'})
  return agent.mode === 'autopilot'
    ? t('Agent: Autopilot', {nsSeparator: '!!'})
    : t('Agent: Suggest', {nsSeparator: '!!'})
}

/** What the person does when the agent gives no answer: by its mode. */
function agentHelpText(agent, t) {
  if (agent.mode === 'report') return t('Check the keywords yourself.')
  return agent.mode === 'autopilot'
    ? t('A flip without an answer gets a random one.')
    : t('Answer the flips yourself.')
}

/** The validation's step for Autopilot (agent/autopilot.js autopilotPlan), or null where it does nothing. */
export function autopilotStep(state) {
  const found = AUTOPILOT_STEPS.find(([path]) => state.matches(path))
  return found ? found[1] : null
}

/** Where the agent is in a validation: 'short', 'long' (the stories), 'keywords', or null (not answering). */
export function agentPhase(state) {
  if (isSubmitting(state) || !isSolving(state)) return null
  if (isShortSession(state)) return 'short'
  return isLongSessionKeywords(state) ? 'keywords' : 'long'
}

function isShortSession(state) {
  return state.matches('shortSession')
}

function isLongSessionFlips(state) {
  return ['flips', 'finishFlips']
    .map((substate) => `longSession.solve.answer.${substate}`)
    .some(state.matches)
}

function isLongSessionKeywords(state) {
  return ['keywords', 'submitLongSession']
    .map((substate) => `longSession.solve.answer.${substate}`)
    .some(state.matches)
}

function isSolving(state) {
  return ['shortSession', 'longSession'].some(state.matches)
}

function isSubmitting(state) {
  return [
    'shortSession.solve.answer.submitShortSession.submitting',
    'longSession.solve.answer.finishFlips',
    'longSession.solve.answer.submitLongSession',
  ].some(state.matches)
}

export function showsSubmitFailed(state, isQuitQuestionOpen) {
  return isSubmitFailed(state) && !isQuitQuestionOpen
}

function isSubmitFailed(state) {
  return [
    ['shortSession', 'submitShortSession'],
    ['longSession', 'submitLongSession'],
  ]
    .map(([state1, state2]) => `${state1}.solve.answer.${state2}.fail`)
    .some(state.matches)
}

function isFirstFlip(state) {
  return ['shortSession', 'longSession']
    .map((substate) => `${substate}.solve.nav.firstFlip`)
    .some(state.matches)
}

function isLastFlip(state) {
  return ['shortSession', 'longSession']
    .map((type) => `${type}.solve.nav.lastFlip`)
    .some(state.matches)
}

function hasManyFlips(state) {
  return sessionFlips(state).length > 1
}

function canSubmit(state) {
  if (isShortSession(state) || isLongSessionFlips(state))
    return (hasAllAnswers(state) || isLastFlip(state)) && !isSubmitting(state)

  if (isLongSessionKeywords(state))
    return (
      (hasAllRelevanceMarks(state) || isLastFlip(state)) && !isSubmitting(state)
    )
}

export function sessionFlips(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  return isShortSession(state)
    ? rearrangeFlips(filterRegularFlips(shortFlips))
    : rearrangeFlips(longFlips.filter(readyFlip))
}

function hasAllAnswers(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  const flips = isShortSession(state)
    ? shortFlips.filter(({decoded, extra}) => decoded && !extra)
    : longFlips.filter(({decoded}) => decoded)
  return flips.length && flips.every(({option}) => option)
}

function hasAllRelevanceMarks({context: {longFlips}}) {
  const flips = longFlips.filter(decodedWithKeywords)
  return flips.every(({relevance}) => relevance)
}
