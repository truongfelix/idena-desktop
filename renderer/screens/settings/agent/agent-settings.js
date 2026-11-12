/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Flex, Stack, Switch, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {ErrorAlert} from '../../../shared/components/components'
import {createPractice, loadPracticeFlips} from '../../validation/practice'
import {
  agentActivity,
  agentErrorText,
  agentStatus,
  clearAgentKey,
  saveAgentSettings,
  setAgentKey,
  testAgentFlip,
} from './api'
import {runPracticeTest} from './practice-test'
import {ModelSection} from './model-section'
import {PermissionsSection} from './permissions-section'
import {ActivitySection} from './activity-section'

/** The test line under the button, from the last run's result. */
export function testResultText(result, t) {
  const answered = t(
    '{{right}} of {{total}} practice flips right, {{seconds}} s per flip',
    {
      right: result.right,
      total: result.total,
      seconds: result.seconds.toFixed(1),
    }
  )
  const reports = t(
    'reports: {{right}} right, {{wrong}} wrong, {{missed}} missed',
    {
      right: result.reportsRight,
      wrong: result.reportsWrong,
      missed: result.reportsMissed,
      nsSeparator: '!!',
    }
  )
  const failed = result.failed
    ? t('{{number}} without an answer ({{message}})', {
        number: result.failed,
        message: agentErrorText(result.lastError),
      })
    : ''
  return [answered, reports, failed].filter(Boolean).join(' · ')
}

function usePracticeTest(t, onDone) {
  const [state, setState] = React.useState({isRunning: false, line: null})
  const stopped = React.useRef(false)

  const start = async () => {
    stopped.current = false
    setState({isRunning: true, line: t('Starting…')})
    try {
      const practice = createPractice(await loadPracticeFlips())
      const result = await runPracticeTest(practice, {
        testFlip: testAgentFlip,
        isStopped: () => stopped.current,
        onProgress: (done, total) =>
          setState({
            isRunning: true,
            line: t('Flip {{done}} of {{total}}…', {done, total}),
          }),
      })
      setState({isRunning: false, line: testResultText(result, t)})
    } catch (error) {
      setState({isRunning: false, line: agentErrorText(error)})
    }
    onDone()
  }

  return {
    ...state,
    line:
      state.line || t('Runs the 15 practice flips; nothing goes to the chain.'),
    start,
    stop: () => {
      stopped.current = true
    },
  }
}

/** Settings › Agent (the approved template's first screen): on/off, the model, what it may do, its activity. */
export function AgentSettings() {
  const {t} = useTranslation()
  const [status, setStatus] = React.useState(null)
  const [activity, setActivity] = React.useState([])
  const [error, setError] = React.useState(null)

  const refreshActivity = React.useCallback(
    () => agentActivity().then(setActivity, () => {}),
    []
  )

  const run = React.useCallback(
    async (call) => {
      try {
        setStatus(await call())
        setError(null)
        refreshActivity()
        return true
      } catch (e) {
        setError(agentErrorText(e))
        return false
      }
    },
    [refreshActivity]
  )

  React.useEffect(() => {
    run(agentStatus)
  }, [run])

  const test = usePracticeTest(t, refreshActivity)

  if (!status) return error ? <ErrorAlert mt={8}>{error}</ErrorAlert> : null
  const {settings} = status
  const save = (next) => run(() => saveAgentSettings(next))

  return (
    <Stack spacing={8} mt={8} maxW="2xl">
      <Flex justify="space-between" align="flex-start" gap={6}>
        <Text color="muted">
          {t(
            'Connect a model to this node and choose what it may do for you. The agent never gets your key: each action it asks for goes through the same steps as your own click, after the permission you set here.',
            {nsSeparator: '!!'}
          )}
        </Text>
        <Box>
          <Switch
            aria-label={t('Agent on')}
            size="lg"
            isChecked={settings.enabled}
            onChange={(e) => save({...settings, enabled: e.target.checked})}
          />
        </Box>
      </Flex>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <ModelSection
        status={status}
        onChange={save}
        onSetKey={(key) => run(() => setAgentKey(key))}
        onClearKey={() => run(clearAgentKey)}
        test={test}
      />
      <PermissionsSection settings={settings} onChange={save} />
      <ActivitySection activity={activity} />
    </Stack>
  )
}
