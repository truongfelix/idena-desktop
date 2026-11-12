/* eslint-disable react/prop-types */
import * as React from 'react'
import {Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider} from '../../../shared/components/components'
import {SettingsSection} from '../components'

function formatTime(ms) {
  return new Date(ms).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/** One line of the log (main/agent/agent.js) in words. */
export function activityText({action, decision, detail}, t) {
  switch (action) {
    case 'answerFlip':
      if (decision === 'failed')
        return t('A flip got no answer: {{detail}}', {
          detail,
          nsSeparator: '!!',
        })
      if (decision === 'off')
        return t('A flip was not sent: the agent may not answer', {
          nsSeparator: '!!',
        })
      return t('Answered a flip: {{detail}}', {detail, nsSeparator: '!!'})
    case 'test':
      return decision === 'failed'
        ? t('Test flip failed: {{detail}}', {detail, nsSeparator: '!!'})
        : t('Test flip answered: {{detail}}', {detail, nsSeparator: '!!'})
    case 'settings':
      return t('Settings saved')
    case 'key':
      return decision === 'removed' ? t('Key removed') : t('Key saved')
    default:
      return `${action} ${decision}`
  }
}

/** What the column on the right says: who decided. */
function how(decision, t) {
  if (decision === 'alone') return t('ALONE')
  if (decision === 'ask') return t('ASKED')
  if (decision === 'failed') return t('FAILED')
  return ''
}

export function ActivitySection({activity}) {
  const {t} = useTranslation()
  return (
    <SettingsSection title={t('Activity')}>
      {activity.length === 0 ? (
        <Text color="muted">{t('Nothing yet.')}</Text>
      ) : (
        <Stack spacing={0}>
          {activity.slice(0, 50).map((entry, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <React.Fragment key={`${entry.at}-${i}`}>
              <HDivider />
              <Flex py={2} gap={4} wrap="wrap">
                <Text
                  w={32}
                  color="muted"
                  sx={{fontVariantNumeric: 'tabular-nums'}}
                >
                  {formatTime(entry.at)}
                </Text>
                <Text flex="1 1 320px" minW={0}>
                  {activityText(entry, t)}
                </Text>
                <Text fontSize="sm" fontWeight={500} color="muted">
                  {how(entry.decision, t)}
                </Text>
              </Flex>
            </React.Fragment>
          ))}
        </Stack>
      )}
      <Text color="muted" fontSize="sm" mt={3}>
        {t('The log is kept until the app closes.')}
      </Text>
    </SettingsSection>
  )
}
