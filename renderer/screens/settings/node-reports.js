/* eslint-disable react/prop-types */
import * as React from 'react'
import {Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {SecondaryButton} from '../../shared/components/button'
import {Tooltip} from '../../shared/components/components'
import {InfoIcon} from '../../shared/components/icons'
import {useInterval} from '../../shared/hooks/use-interval'
import {useNodeState} from '../../shared/providers/node-context'

const nodeReports = (command) =>
  global.ipcRenderer.invoke('node-reports', command)

/** A time as the app shows dates elsewhere: the computer's format and time zone. */
function formatTime(ms) {
  return new Date(ms).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** The row's line on the app's last restart of the node, from its `restarts` (wall clock, ms). */
export function lastRestartText(restarts, t, format = formatTime) {
  if (!restarts?.length) return t('The app has not had to restart the node.')
  return t(
    'The app restarted the node on {{time}}: it had stopped answering.',
    {time: format(Math.max(...restarts)), nsSeparator: '!!'}
  )
}

/**
 * The Node reports row of the Advanced settings (main/node-watchdog.js), as in the phone app: the app's last
 * restart of the node, and buttons to make a report from the running node and to save the last one as a file.
 */
export function NodeReportsSettings({isDisabled}) {
  const {t} = useTranslation()
  const {nodeStarted} = useNodeState()

  const [status, setStatus] = React.useState(null)
  const [isMaking, setIsMaking] = React.useState(false)
  const [note, setNote] = React.useState(null)

  const run = React.useCallback(
    async (command) => {
      try {
        const result = await nodeReports(command)
        if (command === 'save') {
          setNote(result.saved ? t('Saved.') : null)
        } else {
          setStatus(result)
        }
      } catch (error) {
        setNote(
          t('Not done: {{message}}', {
            message: error.message || String(error),
            nsSeparator: '!!',
          })
        )
      }
    },
    [t]
  )

  React.useEffect(() => {
    if (!isDisabled) run('status')
  }, [isDisabled, nodeStarted, run])

  useInterval(() => run('status'), isDisabled ? null : 30 * 1000)

  if (isDisabled || !status) return null

  return (
    <Stack spacing={1}>
      <Stack isInline spacing={1} align="center">
        <Text fontWeight={500}>{t('Node reports')}</Text>
        <Tooltip
          label={`${t(
            'When the node stops answering for 5 minutes, the app writes a report and restarts the node, up to 3 times in 6 hours.'
          )} ${t(
            "A report shows the end of the node's log and, when the app restarted the node, what each part of the node was doing (its goroutines; not on Windows). It holds the node's address and its peers' network addresses, no key."
          )} ${t(
            'If your node has trouble connecting or syncing: Make a report, Save the last report, and share it with the Idena community to understand what happens.',
            {nsSeparator: '!!'}
          )}`}
          placement="top"
          zIndex="tooltip"
        >
          <InfoIcon boxSize={4} color="muted" />
        </Tooltip>
      </Stack>
      <Text color="muted">{lastRestartText(status.restarts, t)}</Text>
      {status.latest && (
        <Text color="muted">
          {t('Last report: {{time}}', {
            time: formatTime(status.latest.madeAt),
            nsSeparator: '!!',
          })}
        </Text>
      )}
      {note && <Text color="muted">{note}</Text>}
      <Stack isInline spacing={2}>
        <SecondaryButton
          isDisabled={!status.nodeRuns || isMaking}
          onClick={async () => {
            setNote(null)
            setIsMaking(true)
            try {
              await run('make')
            } finally {
              setIsMaking(false)
            }
          }}
        >
          {t('Make a report')}
        </SecondaryButton>
        <SecondaryButton
          isDisabled={!status.latest}
          onClick={() => {
            setNote(null)
            run('save')
          }}
        >
          {t('Save the last report')}
        </SecondaryButton>
      </Stack>
    </Stack>
  )
}
