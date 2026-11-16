/* eslint-disable react/prop-types */
import * as React from 'react'
import {Button, Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider} from '../../../shared/components/components'
import {SettingsSection} from '../components'
import {pendingActivityText} from '../../agents/catalog'

/** The time of a line: the hour alone today, the date too before (B-252). */
export function formatTime(ms, now = Date.now()) {
  const at = new Date(ms)
  const today = new Date(now)
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate()
  return at.toLocaleString(
    [],
    sameDay ? {timeStyle: 'short'} : {dateStyle: 'short', timeStyle: 'short'}
  )
}

/** One line of the log (main/agent/agent.js) in words. */
export function activityText({action, decision, detail}, t) {
  const pending = pendingActivityText({action, decision, detail}, t)
  if (pending) return pending
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
      if (decision === 'added') return t('Agent added')
      if (decision === 'removed') return t('Agent removed')
      if (decision === 'paused') return t('All agents paused')
      if (decision === 'resumed') return t('All agents resumed')
      if (decision === 'exported') return t('Agent exported to a file')
      if (decision === 'imported') return t('Agent imported from a file')
      return t('Settings saved')
    case 'flipStory':
      if (decision === 'failed')
        return t('A flip story failed: {{detail}}', {
          detail,
          nsSeparator: '!!',
        })
      if (decision === 'off')
        return t('A flip story was not written: the agent may not', {
          nsSeparator: '!!',
        })
      return t('Wrote a flip story: {{detail}}', {detail, nsSeparator: '!!'})
    case 'flipImage':
      return decision === 'failed'
        ? t('A story picture failed: {{detail}}', {
            detail,
            nsSeparator: '!!',
          })
        : t('Drew a story picture')
    case 'key':
      return decision === 'removed' ? t('Key removed') : t('Key saved')
    // What started a Social run (B-274).
    case 'run':
      if (decision === 'now')
        return t('Run now: a run started by you', {nsSeparator: '!!'})
      if (decision === 'daily')
        return t('Daily run: its time of the day came', {nsSeparator: '!!'})
      if (decision === 'hourly') return t('Hourly run')
      return t('Run on an event: a like, an answer, a tip or a message', {
        nsSeparator: '!!',
      })
    default:
      return `${action} ${decision}`
  }
}

/** What the column on the right says: who decided. */
function how(decision, t) {
  if (decision === 'alone') return t('ALONE')
  if (['ask', 'approved', 'declined'].includes(decision)) return t('ASKED')
  if (decision === 'failed') return t('FAILED')
  return ''
}

/**
 * The log as shown (B-252): the lines that say the same thing in a row (five "Settings saved") as one, with their
 * count and the newest time; newest first, as the log comes.
 */
export function groupActivity(activity, t) {
  const rows = []
  activity.forEach((entry) => {
    const text = activityText(entry, t)
    const who = how(entry.decision, t)
    const last = rows[rows.length - 1]
    if (last && last.text === text && last.how === who) last.count += 1
    else rows.push({at: entry.at, text, how: who, count: 1})
  })
  return rows
}

export function ActivitySection({activity, onClear}) {
  const {t} = useTranslation()
  const rows = groupActivity(activity, t).slice(0, 50)
  return (
    <SettingsSection
      title={t('Activity')}
      info={t(
        'Everything the agent did, asked for or was refused, newest first. The log is kept until the app closes.'
      )}
      foldId="agent.activity"
      summary={activity.length ? formatTime(activity[0].at) : t('Nothing yet.')}
    >
      {rows.length === 0 ? (
        <Text color="muted">{t('Nothing yet.')}</Text>
      ) : (
        <Stack spacing={0}>
          {rows.map((row, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <React.Fragment key={`${row.at}-${i}`}>
              {i > 0 && <HDivider />}
              <Flex py={1.5} gap={4} align="baseline" minW={0}>
                <Text
                  flexShrink={0}
                  whiteSpace="nowrap"
                  color="muted"
                  fontSize="sm"
                  sx={{fontVariantNumeric: 'tabular-nums'}}
                >
                  {formatTime(row.at)}
                </Text>
                <Text flex={1} minW={0} isTruncated title={row.text}>
                  {row.text}
                  {row.count > 1 && (
                    <Text as="span" color="muted">{` ×${row.count}`}</Text>
                  )}
                </Text>
                {row.how && (
                  <Text
                    flexShrink={0}
                    fontSize="xs"
                    fontWeight={500}
                    color="muted"
                  >
                    {row.how}
                  </Text>
                )}
              </Flex>
            </React.Fragment>
          ))}
        </Stack>
      )}
      <Flex mt={3} gap={4} align="center" justify="flex-end">
        {onClear && rows.length > 0 && (
          <Button size="sm" variant="link" colorScheme="blue" onClick={onClear}>
            {t('Clear')}
          </Button>
        )}
      </Flex>
    </SettingsSection>
  )
}
