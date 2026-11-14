/* eslint-disable react/prop-types */
import * as React from 'react'
import {Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {FormControlWithLabel, Select} from '../../shared/components/components'
import {SecondaryButton} from '../../shared/components/button'
import {SettingsSection} from '../settings/components'
import {useSocial} from '../social/provider'
import {DEFAULT_JOKE_INSTRUCTIONS} from './joke/joke'
import {runAgentNow} from './joke/runner'
import {socialReadyForJokes} from './joke/run'

/** An agent given the daily joke: its post action (Off, once a day) and a daily time, its instructions the template's. */
export function withJokeTask(agent) {
  return {
    ...agent,
    task: 'joke',
    instructions: agent.instructions.trim()
      ? agent.instructions
      : DEFAULT_JOKE_INSTRUCTIONS,
    actions: agent.actions.post
      ? agent.actions
      : {...agent.actions, post: {level: 'off', limit: 1}},
    schedule:
      agent.schedule.kind === 'daily'
        ? agent.schedule
        : {...agent.schedule, kind: 'daily'},
  }
}

/** What the run says, in words. */
function runLine({result, detail}, t) {
  switch (result) {
    case 'posted':
      return t('Posted ({{detail}})', {detail})
    case 'ask':
      return t('The joke waits in To approve, on the Agents page.')
    case 'skipped':
      return detail
    case 'done today':
      return t('A joke was already posted today.')
    case 'waiting':
      return t("Today's joke already waits in To approve.")
    case 'running':
      return t('It is running now.')
    case 'off':
      return t('Not allowed: {{detail}}', {detail, nsSeparator: '!!'})
    default:
      return t('It failed: {{detail}}', {detail, nsSeparator: '!!'})
  }
}

/** "Task": what the agent does when it runs (the daily joke of 3615 IDENA), and a run now. */
export function TaskSection({agent, onChange}) {
  const {t} = useTranslation()
  const social = useSocial()
  const [line, setLine] = React.useState(null)
  const [isRunning, setIsRunning] = React.useState(false)
  const isJoke = agent.task === 'joke'

  return (
    <SettingsSection title={t('Task')}>
      <Stack spacing={4}>
        <FormControlWithLabel label={t('What it does when it runs')}>
          <Select
            value={agent.task || ''}
            onChange={(e) => {
              // Read now: the change is applied later, to the agent as saved, when React has put the select back.
              const task = e.target.value
              onChange((a) =>
                task === 'joke' ? withJokeTask(a) : {...a, task: null}
              )
            }}
          >
            <option value="">{t('Only the actions below')}</option>
            <option value="joke">
              {t('The daily joke of 3615 IDENA, paid by tips')}
            </option>
          </Select>
        </FormControlWithLabel>
        {isJoke && (
          <>
            <Text fontSize="sm" color="muted">
              {t(
                "The model writes the joke alone. The app writes the rest of the post: the header, the joke's number, the thanks line (each tipper's name from their profile, else the short address) and the last line. No tip since the last joke: no joke that day.",
                {nsSeparator: '!!'}
              )}
            </Text>
            <Flex gap={4} align="center" wrap="wrap">
              <SecondaryButton
                isLoading={isRunning}
                isDisabled={!agent.enabled || !socialReadyForJokes(social)}
                onClick={async () => {
                  setIsRunning(true)
                  setLine(null)
                  try {
                    setLine(runLine(await runAgentNow(agent, social, t), t))
                  } catch (error) {
                    setLine(
                      runLine(
                        {result: 'failed', detail: error?.message || ''},
                        t
                      )
                    )
                  } finally {
                    setIsRunning(false)
                  }
                }}
              >
                {t('Run now')}
              </SecondaryButton>
              <Text color="muted" fontSize="sm">
                {line ||
                  (socialReadyForJokes(social)
                    ? t('Runs once a day at its time, while the app is open.')
                    : t('Waits for Social to read the chain up to now.'))}
              </Text>
            </Flex>
          </>
        )}
      </Stack>
    </SettingsSection>
  )
}
