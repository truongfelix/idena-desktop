import * as React from 'react'
import NextLink from 'next/link'
import {Box, Button, Link, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  agentStatus,
  lastAgentStatus,
  onAgentChange,
  updateAgentSettings,
} from './api'
import {AGENT_COLORS} from '../../validation/agent/picks'

/** What the agent does now, in the menu's card (the approved design's screen 2), from its status. */
export function agentCardLine(t, {settings, hasKey}) {
  if (settings.paused)
    return t('Paused: it does nothing until you resume it.', {
      nsSeparator: '!!',
    })
  if (!settings.model) return t('No model chosen yet')
  if (settings.provider !== 'local' && !hasKey)
    return t('No API key kept for this service')
  const {level} = settings.permissions.answerFlip
  if (level === 'alone') return t('Autopilot in the validation')
  if (level === 'ask') return t('Suggests the answers in the validation')
  return t('Answers in the validation are off')
}

/**
 * The agent's card at the foot of the menu, when the agent is on: what it does, and a button that pauses it
 * everywhere (or resumes it). Its name opens Settings › Agent.
 */
export function AgentCard() {
  const {t} = useTranslation()
  // The last status known first: the menu mounts again at each page, the card does not blink.
  const [status, setStatus] = React.useState(lastAgentStatus)
  const [isBusy, setIsBusy] = React.useState(false)

  React.useEffect(() => {
    let live = true
    const show = (next) => live && setStatus(next)
    agentStatus().then(show, () => {})
    const off = onAgentChange(show)
    return () => {
      live = false
      off()
    }
  }, [])

  if (!status?.settings.enabled) return null
  const {paused} = status.settings

  return (
    <Box
      borderWidth={1}
      borderColor={paused ? 'xwhite.016' : AGENT_COLORS.dark}
      borderRadius="md"
      p={3}
      mb={3}
      fontSize="sm"
    >
      <Link
        as={NextLink}
        href="/settings/agent"
        fontWeight={500}
        color={paused ? 'white' : AGENT_COLORS.dark}
      >
        {paused ? t('Agent paused') : t('Agent on')}
      </Link>
      <Text color="xwhite.050" mt={1}>
        {agentCardLine(t, status)}
      </Text>
      <Button
        mt={2}
        size="sm"
        w="full"
        variant="outline"
        color="white"
        borderColor="xwhite.016"
        _hover={{bg: 'xwhite.010'}}
        isLoading={isBusy}
        onClick={() => {
          setIsBusy(true)
          // Applied to the saved settings in turn with every other change (api.js). A failed save: the card shows
          // what the main process holds.
          updateAgentSettings((s) => ({...s, paused: !paused}))
            .catch(() => agentStatus().then(setStatus, () => {}))
            .finally(() => setIsBusy(false))
        }}
      >
        {paused ? t('Resume the agent') : t('Pause the agent')}
      </Button>
    </Box>
  )
}
