import * as React from 'react'
import NextLink from 'next/link'
import {Box, Button, Link, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {agentStatus, onAgentChange, saveAgentSettings} from './api'
import {AGENT_COLORS} from '../../validation/agent/picks'

/** What the agent does now, in the menu's card (the approved design's screen 2). */
export function agentCardLine(t, settings) {
  if (settings.paused)
    return t('Paused: it does nothing until you resume it.', {
      nsSeparator: '!!',
    })
  const {level} = settings.permissions.answerFlip
  if (level === 'alone') return t('Autopilot in the validation')
  if (level === 'ask') return t('Suggests the answers in the validation')
  return t('Every action is off')
}

/**
 * The agent's card at the foot of the menu, when the agent is on: what it does, and a button that pauses it
 * everywhere (or resumes it). Its name opens Settings › Agent.
 */
export function AgentCard() {
  const {t} = useTranslation()
  const [settings, setSettings] = React.useState(null)

  React.useEffect(() => {
    let live = true
    const show = (status) => live && setSettings(status.settings)
    agentStatus().then(show, () => {})
    const off = onAgentChange(show)
    return () => {
      live = false
      off()
    }
  }, [])

  if (!settings?.enabled) return null
  const {paused} = settings

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
        {agentCardLine(t, settings)}
      </Text>
      <Button
        mt={2}
        size="sm"
        w="full"
        variant="outline"
        color="white"
        borderColor="xwhite.016"
        _hover={{bg: 'xwhite.010'}}
        onClick={async () => {
          // The saved settings, not this card's copy: another page may have changed them since.
          const current = (await agentStatus()).settings
          await saveAgentSettings({...current, paused: !current.paused})
        }}
      >
        {paused ? t('Resume the agent') : t('Pause the agent')}
      </Button>
    </Box>
  )
}
