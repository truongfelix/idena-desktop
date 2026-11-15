/* eslint-disable react/prop-types */
import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {SecondaryButton} from '../../shared/components/button'
import {useSuccessToast} from '../../shared/hooks/use-toast'
import {useSocial} from '../social/provider'
import {isSocialAgent, runAgentNow, socialReady} from './runner'

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

/** Why Run now is off, or nothing. */
function buttonTitle({enabled, paused, ready}, t) {
  if (!enabled) return t('Turn the agent on first.')
  if (paused)
    return t('Every agent is paused: none acts until you resume them.', {
      nsSeparator: '!!',
    })
  if (!ready) return t('Waits for Social to read the chain up to now.')
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
  if (!isSocialAgent(agent)) return null
  const ready = socialReady(social)
  return (
    <SecondaryButton
      isLoading={isRunning}
      isDisabled={!agent.enabled || paused || !ready}
      title={buttonTitle({enabled: agent.enabled, paused, ready}, t)}
      onClick={async () => {
        setIsRunning(true)
        let line
        try {
          line = runLine(await runAgentNow(agent, social, t), t)
        } catch (error) {
          line = runLine({result: 'failed', detail: error?.message || ''}, t)
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
