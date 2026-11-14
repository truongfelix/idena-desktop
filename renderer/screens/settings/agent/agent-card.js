import * as React from 'react'
import NextLink from 'next/link'
import {Box, Button, Link, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  agentStatus,
  agentsList,
  lastAgentStatus,
  lastAgentsList,
  onAgentChange,
  onAgentsChange,
  setAgentsPaused,
} from './api'
import {AGENT_COLORS} from '../../validation/agent/picks'
import {usePendingActions} from '../../agents/pending-api'

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

/** The card's line while actions wait in To approve. */
export const agentsToApproveLine = (t, count) =>
  count === 1
    ? t('1 action to approve')
    : t('{{count}} actions to approve', {count})

/**
 * The card's line: the actions waiting in To approve; else, with one agent on answering the validation, what it does
 * there; else that they are paused, or the names of the agents on.
 */
export function agentsCardLine(t, {status, on, paused, toApprove}) {
  if (toApprove) return agentsToApproveLine(t, toApprove)
  if (on.length === 1 && on[0].actions.answerFlip)
    return agentCardLine(t, status)
  if (paused)
    return t('Every agent is paused: none acts until you resume them.', {
      nsSeparator: '!!',
    })
  return on.map((agent) => agent.name).join(', ')
}

/** The card's title: how many agents are on, or that they are paused. */
export function agentsCardTitle(t, list) {
  if (list.paused) return t('Agents paused')
  const on = list.agents.filter((agent) => agent.enabled).length
  return on === 1 ? t('1 agent on') : t('{{count}} agents on', {count: on})
}

/**
 * The agents' card at the foot of the menu, when one agent is on at least: what they do, and a button that pauses
 * them all (or resumes them). Its title opens Agents.
 */
export function AgentCard() {
  const {t} = useTranslation()
  // The last status and list known first: the menu mounts again at each page, the card does not blink.
  const [status, setStatus] = React.useState(lastAgentStatus)
  const [list, setList] = React.useState(lastAgentsList)
  const [isBusy, setIsBusy] = React.useState(false)
  const toApprove = (usePendingActions() || []).length

  React.useEffect(() => {
    let live = true
    const show = (next) => live && setStatus(next)
    const showList = (next) => live && setList(next)
    agentStatus().then(show, () => {})
    agentsList().then(showList, () => {})
    const off = onAgentChange(show)
    const offList = onAgentsChange(showList)
    return () => {
      live = false
      off()
      offList()
    }
  }, [])

  if (!list || !status) return null
  const on = list.agents.filter((agent) => agent.enabled)
  if (on.length === 0 && toApprove === 0) return null
  const {paused} = list
  const line = agentsCardLine(t, {status, on, paused, toApprove})

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
        href="/agents"
        fontWeight={500}
        color={paused ? 'white' : AGENT_COLORS.dark}
      >
        {agentsCardTitle(t, list)}
      </Link>
      <Text color="xwhite.050" mt={1} noOfLines={2}>
        {line}
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
          // Applied in turn with every other change (api.js). A failed save: the card shows what the main process
          // holds.
          setAgentsPaused(!paused)
            .catch(() => agentsList().then(setList, () => {}))
            .finally(() => setIsBusy(false))
        }}
      >
        {paused ? t('Resume all agents') : t('Pause all agents')}
      </Button>
    </Box>
  )
}
