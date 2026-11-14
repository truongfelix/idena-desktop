import * as React from 'react'
import {createPractice, loadPracticeFlips} from '../validation/practice'
import {
  agentErrorText,
  stopAgentTest,
  testAgentFlip,
} from '../settings/agent/api'
import {runPracticeTest} from '../settings/agent/practice-test'

// The practice test of an agent that answers the validation (its page in Agents): the 15 practice flips sent to
// its model one at a time, nothing to the chain.

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

/** The practice test of the validation agent, or of the agent `agentId` (its page in Agents). */
export function usePracticeTest(t, onDone, agentId) {
  const [state, setStateNow] = React.useState({
    isRunning: false,
    line: null,
    reports: [],
  })
  const stopped = React.useRef(false)
  const mounted = React.useRef(true)
  const setState = (value) => mounted.current && setStateNow(value)

  // Leaving the page stops the test: no more flips sent, the one in flight ended in the main process.
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopped.current = true
      stopAgentTest().catch(() => {})
    }
  }, [])

  const start = async () => {
    stopped.current = false
    setState({isRunning: true, line: t('Starting…'), reports: []})
    try {
      const practice = createPractice(await loadPracticeFlips())
      const result = await runPracticeTest(practice, {
        testFlip: (flip, timeoutMs) => testAgentFlip(flip, timeoutMs, agentId),
        isStopped: () => stopped.current,
        onProgress: (done, total) =>
          setState({
            isRunning: true,
            line: t('Flip {{done}} of {{total}}…', {done, total}),
            reports: [],
          }),
      })
      setState({
        isRunning: false,
        line: testResultText(result, t),
        reports: result.reports,
      })
    } catch (error) {
      setState({isRunning: false, line: agentErrorText(error), reports: []})
    }
    if (mounted.current) onDone()
  }

  return {
    ...state,
    line:
      state.line || t('Runs the 15 practice flips; nothing goes to the chain.'),
    start,
    stop: () => {
      stopped.current = true
      stopAgentTest().catch(() => {})
    },
  }
}
