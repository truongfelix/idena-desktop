/* eslint-disable react/prop-types */
import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {Stack, Text} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  FormControlWithLabel,
  Input,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {useSuccessToast} from '../../shared/hooks/use-toast'
import {useSocial} from '../social/provider'
import {agentErrorText} from '../settings/agent/api'
import {isRunning, isSocialAgent, socialReady} from './runner'
import {scannedHeight} from './social/run'

// Read again the last N hours (B-295), in the agent page's header: the agent's read point goes back N hours of
// blocks, so that its next run reads again what it passed over (a post refused under criteria changed since). What it
// already answered is skipped, and what it reads counts in its day as usual.

export const MAX_HOURS = 24

/** The hours typed, as a whole number from 1 to MAX_HOURS, or null. */
export function hoursOf(text) {
  const value = String(text).trim()
  if (!/^[0-9]{1,2}$/.test(value)) return null
  const hours = Number(value)
  return hours >= 1 && hours <= MAX_HOURS ? hours : null
}

const readAgain = (agentId, hours, head) =>
  global.ipcRenderer.invoke('agent', 'readAgain', {agentId, hours, head})

export function ReadAgain({agent, onDone}) {
  const {t} = useTranslation()
  const social = useSocial()
  const toast = useSuccessToast()
  const [isOpen, setIsOpen] = React.useState(false)
  const [text, setText] = React.useState('2')
  const [error, setError] = React.useState(null)
  if (!isSocialAgent(agent)) return null
  const ready = socialReady(social)
  const hours = hoursOf(text)
  return (
    <>
      <SecondaryButton
        isDisabled={!ready}
        title={
          ready ? undefined : t('Waits for Social to read the chain up to now.')
        }
        onClick={() => {
          setError(null)
          setIsOpen(true)
        }}
      >
        {t('Read again…')}
      </SecondaryButton>
      <Dialog
        title={t('Read again the last hours')}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <DialogBody>
          <Stack spacing={3}>
            <Text>
              {t(
                'Its next run reads again what came on Social in the last hours you choose, within what it reads and its numbers of the day. What it already answered is skipped.'
              )}
            </Text>
            <FormControlWithLabel label={t('Hours, from 1 to 24')}>
              <Input
                value={text}
                inputMode="numeric"
                maxLength={2}
                onChange={(e) => setText(e.target.value)}
              />
            </FormControlWithLabel>
            {error && <Text color="red.500">{error}</Text>}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={() => setIsOpen(false)}>
            {t('Cancel')}
          </SecondaryButton>
          <PrimaryButton
            isDisabled={hours === null}
            onClick={async () => {
              // A run going on saves its point at its end, past this one: wait for it.
              if (isRunning(agent.id)) {
                setError(t('It is running now. Try again when its run ends.'))
                return
              }
              try {
                await readAgain(agent.id, hours, scannedHeight(social))
                setIsOpen(false)
                toast({
                  title: t('Read again'),
                  description: t(
                    'Its next run reads again from {{hours}} h ago.',
                    {hours}
                  ),
                })
                onDone()
              } catch (failure) {
                setError(agentErrorText(failure))
              }
            }}
          >
            {t('Read again')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    </>
  )
}
