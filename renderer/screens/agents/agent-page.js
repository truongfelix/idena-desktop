/* eslint-disable react/prop-types */
import * as React from 'react'
import NextLink from 'next/link'
import {useRouter} from 'next/router'
import {
  Box,
  Flex,
  Link,
  Stack,
  Switch,
  Text,
  VisuallyHidden,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  ErrorAlert,
  Input,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {
  agentActivity,
  clearAgentActivity,
  clearServiceKey,
  removeAgent,
  setServiceKey,
  updateAgent,
} from '../settings/agent/api'
import {usePracticeTest} from './practice-run'
import {ModelSection} from '../settings/agent/model-section'
import {ReportRulesSection} from '../settings/agent/report-rules-section'
import {ActivitySection} from '../settings/agent/activity-section'
import {ActionsSection} from './actions-section'
import {saveAgentFile} from './agent-file'
import {AgentBadge} from './agents-list'
import {actionCatalog} from './catalog'
import {useAgents} from './use-agents'
import {
  InstructionsSection,
  ReadsSection,
  ScheduleSection,
  useDraft,
} from './page-sections'
import {RunNow} from './run-now'

function NameField({value, onSave}) {
  const {t} = useTranslation()
  const [draft, setDraft] = useDraft(value)
  const save = (e) => {
    const next = e.currentTarget.value.trim()
    if (next && next !== value) onSave(next)
    else setDraft(value)
  }
  return (
    <Input
      aria-label={t('Name')}
      value={draft}
      maxLength={60}
      fontSize="xl"
      fontWeight={500}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      // Enter leaves the field: its blur saves, once.
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

/** Delete, in the page's header (B-253), with its confirmation. */
function DeleteAgent({agent, onRemove}) {
  const {t} = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  return (
    <>
      <SecondaryButton color="red.500" onClick={() => setIsOpen(true)}>
        {t('Delete')}
      </SecondaryButton>
      <Dialog
        title={t('Delete {{name}}?', {name: agent.name})}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <DialogBody>
          <Text>
            {t(
              'Its instructions, actions and settings are deleted. The key of its service stays for the other agents.'
            )}
          </Text>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={() => setIsOpen(false)}>
            {t('Cancel')}
          </SecondaryButton>
          <PrimaryButton
            colorScheme="red"
            onClick={() => {
              setIsOpen(false)
              onRemove()
            }}
          >
            {t('Delete the agent')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    </>
  )
}

/** One agent's page: its name and switch, connection, instructions, actions, what it reads, schedule, Activity. */
export function AgentPage({id}) {
  const {t} = useTranslation()
  const router = useRouter()
  const {list, error, run} = useAgents()
  const [activity, setActivity] = React.useState([])
  const catalog = actionCatalog(t)
  const refreshActivity = React.useCallback(
    () => agentActivity(id).then(setActivity, () => {}),
    [id]
  )
  React.useEffect(() => {
    refreshActivity()
  }, [refreshActivity, list])
  const test = usePracticeTest(t, refreshActivity, id)

  const agent = list && list.agents.find((a) => a.id === id)
  const back = (
    <Link as={NextLink} href="/agents" color="blue.500" fontSize="sm">
      {t('← Agents', {nsSeparator: '!!'})}
    </Link>
  )
  if (!list) return error ? <ErrorAlert>{error}</ErrorAlert> : null
  if (!agent)
    return (
      <Stack spacing={4}>
        {back}
        <Text color="muted">{t('This agent was removed.')}</Text>
      </Stack>
    )

  // Each change applied to the agent as saved when its turn comes (api.js): two quick changes cannot undo each
  // other, and a key saved after an address change still being saved is bound to the new address.
  const save = (change) => run(() => updateAgent(id, change))
  const status = {
    settings: agent,
    keychain: list.keychain,
    hasKey: agent.hasKey,
    keyElsewhere: false,
  }
  const isValidation = Boolean(agent.actions.answerFlip || agent.actions.report)

  return (
    <Stack spacing={8} w="full" maxW="4xl" pb={8}>
      {back}
      <Flex justify="space-between" align="center" gap={4}>
        <Flex gap={3} align="center" flex={1} minW={0}>
          <AgentBadge name={agent.name} size={12} />
          <Box flex={1} maxW="md">
            <VisuallyHidden as="h1">{agent.name}</VisuallyHidden>
            <NameField
              value={agent.name}
              onSave={(name) => save((a) => ({...a, name}))}
            />
          </Box>
        </Flex>
        <Flex gap={3} align="center">
          <RunNow agent={agent} paused={list.paused} onDone={refreshActivity} />
          <SecondaryButton
            onClick={() =>
              run(() => saveAgentFile(id)).then(() => refreshActivity())
            }
          >
            {t('Export')}
          </SecondaryButton>
          <DeleteAgent
            agent={agent}
            onRemove={async () => {
              if (await run(() => removeAgent(id))) router.push('/agents')
            }}
          />
          <Switch
            size="lg"
            aria-label={t('{{name}} on', {name: agent.name})}
            isChecked={agent.enabled}
            onChange={(e) => {
              const enabled = e.target.checked
              save((a) => ({...a, enabled}))
            }}
          />
        </Flex>
      </Flex>
      {list.paused && (
        <Text color="muted">
          {t('Every agent is paused: none acts until you resume them.', {
            nsSeparator: '!!',
          })}
        </Text>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <ModelSection
        title={t('Connection')}
        status={status}
        onChange={save}
        onSetKey={(key) => run(() => setServiceKey(id, key)).then(Boolean)}
        onClearKey={() => run(() => clearServiceKey(id))}
        test={isValidation ? test : null}
        info={t(
          "Where the model runs. On this computer, nothing leaves it; a service is sent what the agent reads, and nothing else. One key per service, kept in this computer's keychain and shared by the agents that use that service.",
          {nsSeparator: '!!'}
        )}
      />
      <InstructionsSection agent={agent} onChange={save} />
      <ActionsSection
        agent={agent}
        agents={list.agents}
        catalog={catalog}
        onChange={save}
      />
      <ReadsSection agent={agent} catalog={catalog} onChange={save} />
      <ScheduleSection agent={agent} catalog={catalog} onChange={save} />
      {agent.actions.report && (
        <ReportRulesSection settings={agent} onChange={save} />
      )}
      <ActivitySection
        activity={activity}
        onClear={() => run(() => clearAgentActivity(id)).then(refreshActivity)}
      />
    </Stack>
  )
}
