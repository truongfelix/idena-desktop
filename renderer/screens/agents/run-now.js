/* eslint-disable react/prop-types */
import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {SecondaryButton} from '../../shared/components/button'
import {useSuccessToast} from '../../shared/hooks/use-toast'
import {useSocial} from '../social/provider'
import {agentErrorText} from '../settings/agent/api'
import {
  flipsReady,
  isFlipsAgent,
  isSocialAgent,
  runAgentNow,
  socialReady,
} from './runner'

/** What a run says, in words. */
export function runLine({result, detail}, t) {
  switch (result) {
    case 'done':
      return detail
    case 'nothing new':
      return t('Nothing new since its last run: the model was not asked.', {
        nsSeparator: '!!',
      })
    case 'running':
      return t('It is running now.')
    case 'off':
      return t('Not allowed: {{detail}}', {detail, nsSeparator: '!!'})
    default:
      return t('It failed: {{detail}}', {detail, nsSeparator: '!!'})
  }
}

/**
 * The message after a run that threw: the reason alone, as Activity shows it (B-273), not Electron's "Error invoking
 * remote method" before it.
 */
export const failedLine = (error, t) =>
  runLine({result: 'failed', detail: agentErrorText(error)}, t)

/** Why Run now is off, or nothing. */
function buttonTitle({enabled, paused, waits}, t) {
  if (!enabled) return t('Turn the agent on first.')
  if (paused)
    return t('Every agent is paused: none acts until you resume them.', {
      nsSeparator: '!!',
    })
  if (waits === 'social')
    return t('Waits for Social to read the chain up to now.')
  if (waits === 'flips')
    return t('Waits for the node to give the identity and the epoch.')
  return undefined
}

/**
 * Run now, in the agent page's header: one run at once, whatever its schedule, for an agent that is on and holds a
 * Social action; it waits for Social to read the chain up to now. What the run did shows in a message and Activity.
 */
export function RunNow({agent, paused, onDone}) {
  const {t} = useTranslation()
  const social = useSocial()
  const toast = useSuccessToast()
  const [isRunning, setIsRunning] = React.useState(false)
  if (!isSocialAgent(agent) && !isFlipsAgent(agent)) return null
  // One on Social waits for the scan; one in the Flips area for the identity and the epoch (B-258).
  let waits = null
  if (isSocialAgent(agent) && !socialReady(social)) waits = 'social'
  else if (isFlipsAgent(agent) && !flipsReady()) waits = 'flips'
  return (
    <SecondaryButton
      isLoading={isRunning}
      isDisabled={!agent.enabled || paused || waits !== null}
      title={buttonTitle({enabled: agent.enabled, paused, waits}, t)}
      onClick={async () => {
        setIsRunning(true)
        let line
        try {
          line = runLine(await runAgentNow(agent, social, t), t)
        } catch (error) {
          line = failedLine(error, t)
        } finally {
          setIsRunning(false)
        }
        toast({title: t('Run now'), description: line})
        onDone()
      }}
    >
      {t('Run now')}
    </SecondaryButton>
  )
}
