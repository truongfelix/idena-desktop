/* eslint-disable react/prop-types */
import * as React from 'react'
import NextLink from 'next/link'
import {useRouter} from 'next/router'
import {
  Box,
  Flex,
  Heading,
  Link,
  SimpleGrid,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {ErrorAlert, PageTitle} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {
  agentActivity,
  setAgentsPaused,
  updateAgent,
} from '../settings/agent/api'
import {activityText} from '../settings/agent/activity-section'
import {
  actionCatalog,
  actionsLine,
  budgetLine,
  connectionLine,
  initialOf,
  readsList,
  runsLine,
} from './catalog'
import {useAgents} from './use-agents'
import {ToApprove} from './to-approve'
import {usePendingActions} from './pending-api'
import {ImportAgent} from './agent-file'

/** The agent's letter on a soft square, as on the cards and its page. */
export function AgentBadge({name, size = 10}) {
  return (
    <Flex
      w={size}
      h={size}
      flexShrink={0}
      align="center"
      justify="center"
      borderRadius="lg"
      bg="blue.012"
      color="blue.500"
      fontWeight={600}
      aria-hidden
    >
      {initialOf(name)}
    </Flex>
  )
}

function Fact({label, children}) {
  return (
    <>
      <Text as="dt" color="muted">
        {label}
      </Text>
      <Text as="dd" m={0} minW={0}>
        {children}
      </Text>
    </>
  )
}

function AgentCard({agent, catalog, last, paused, onToggle}) {
  const {t} = useTranslation()
  const href = `/agents/view?id=${agent.id}`
  return (
    <Stack
      as="article"
      borderWidth={1}
      borderColor="gray.100"
      borderRadius="lg"
      p={5}
      spacing={4}
    >
      <Flex justify="space-between" align="flex-start" gap={3}>
        <Flex gap={3} align="center" minW={0}>
          <AgentBadge name={agent.name} />
          <Box minW={0}>
            <Heading as="h3" fontSize="md" fontWeight={600} noOfLines={1}>
              {agent.name}
            </Heading>
            <Text fontSize="sm" color="muted" noOfLines={1}>
              {connectionLine(agent, t)}
            </Text>
          </Box>
        </Flex>
        <Switch
          aria-label={t('{{name}} on', {name: agent.name})}
          isChecked={agent.enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </Flex>
      <Box
        as="dl"
        display="grid"
        gridTemplateColumns="88px minmax(0, 1fr)"
        gridGap="8px 12px"
        fontSize="sm"
      >
        <Fact label={t('Actions')}>{actionsLine(agent, catalog, t)}</Fact>
        <Fact label={t('Runs')}>{runsLine(agent, t)}</Fact>
        <Fact label={t('Reads')}>
          {readsList(agent, catalog, t).join(', ')}
        </Fact>
        <Fact label={t('Budget')}>{budgetLine(agent, t, catalog)}</Fact>
      </Box>
      <Flex
        justify="space-between"
        align="center"
        gap={3}
        borderTopWidth={1}
        borderColor="gray.100"
        pt={3}
        wrap="wrap"
      >
        <Text fontSize="sm" color="muted" minW={0} noOfLines={1}>
          {paused && agent.enabled
            ? t('Paused with every agent')
            : last || (agent.enabled ? t('Nothing yet.') : t('Off'))}
        </Text>
        <Link as={NextLink} href={href} color="blue.500" fontWeight={500}>
          {t('Open')}
        </Link>
      </Flex>
    </Stack>
  )
}

/** Agents: the person's agents as cards, each opening its page; New agent adds one, empty and off. */
export function AgentsList() {
  const {t} = useTranslation()
  const router = useRouter()
  const {list, error, run} = useAgents()
  const [note, setNote] = React.useState(null)
  const pending = usePendingActions()
  const [activity, setActivity] = React.useState([])
  const catalog = actionCatalog(t)

  React.useEffect(() => {
    agentActivity().then(setActivity, () => {})
  }, [list, pending])

  const lastLine = (id) => {
    const entry = activity.find((line) => line.agentId === id)
    return entry ? activityText(entry, t) : null
  }

  return (
    <Stack spacing={8} w="full" maxW="5xl">
      <Flex justify="space-between" align="flex-start" gap={4} wrap="wrap">
        <Box maxW="xl">
          <PageTitle mb={1}>{t('Agents')}</PageTitle>
          <Text color="muted">
            {t(
              'Models that act for this identity, each with its own instructions, actions and limits. No agent gets your key: each action goes through the same steps as your own click.',
              {nsSeparator: '!!'}
            )}
          </Text>
        </Box>
        <Flex gap={2} wrap="wrap">
          {list && list.agents.length > 0 && (
            <SecondaryButton
              onClick={() => run(() => setAgentsPaused(!list.paused))}
            >
              {list.paused ? t('Resume all agents') : t('Pause all agents')}
            </SecondaryButton>
          )}
          <ImportAgent onError={setNote} />
          <PrimaryButton
            onClick={async () => {
              const saved = await run(() =>
                updateAgent(null, () => ({name: t('New agent')}))
              )
              if (saved && saved.savedId)
                router.push(`/agents/view?id=${saved.savedId}`)
            }}
          >
            {t('New agent')}
          </PrimaryButton>
        </Flex>
      </Flex>
      {(error || note) && <ErrorAlert>{error || note}</ErrorAlert>}
      {list && list.paused && (
        <Text>
          {t('Every agent is paused: none acts until you resume them.', {
            nsSeparator: '!!',
          })}
        </Text>
      )}
      <ToApprove items={pending} />
      {list && (
        <Stack spacing={3}>
          <Heading as="h2" fontSize="md" fontWeight={600}>
            {t('Your agents')}
          </Heading>
          {list.agents.length === 0 ? (
            <Text color="muted">
              {t(
                'No agent yet. A new agent starts empty and off: you give it a model, its instructions and the actions it may do.',
                {nsSeparator: '!!'}
              )}
            </Text>
          ) : (
            <SimpleGrid minChildWidth="300px" spacing={4}>
              {list.agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  catalog={catalog}
                  paused={list.paused}
                  last={lastLine(agent.id)}
                  onToggle={(enabled) =>
                    run(() => updateAgent(agent.id, (a) => ({...a, enabled})))
                  }
                />
              ))}
            </SimpleGrid>
          )}
        </Stack>
      )}
    </Stack>
  )
}
