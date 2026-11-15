/* eslint-disable react/prop-types */
import * as React from 'react'
import NextLink from 'next/link'
import {useRouter} from 'next/router'
import {
  Box,
  Flex,
  Link,
  SimpleGrid,
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
  FormControlWithLabel,
  HDivider,
  Input,
  Select,
  Textarea,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {SettingsSection} from '../settings/components'
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
import {TaskSection} from './task-section'
import {saveAgentFile} from './agent-file'
import {DEFAULT_JOKE_INSTRUCTIONS} from './joke/joke'
import {AgentBadge} from './agents-list'
import {actionCatalog, readsList} from './catalog'
import {useAgents} from './use-agents'

/** A text field saved when it loses the focus, not at each key. */
function useDraft(value) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  return [draft, setDraft]
}

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

function InstructionsSection({agent, onChange}) {
  const {t} = useTranslation()
  const [draft, setDraft] = useDraft(agent.instructions)
  return (
    <SettingsSection
      title={t('Instructions')}
      foldId="agent.instructions"
      summary={
        agent.instructions.trim().split('\n')[0] ||
        t("None: the app's own text for each action", {nsSeparator: '!!'})
      }
    >
      <FormControlWithLabel
        label={t(
          'Sent to the model with each of its actions: solving a flip, writing a post',
          {nsSeparator: '!!'}
        )}
      >
        <Textarea
          rows={6}
          value={draft}
          maxLength={20000}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            const next = e.currentTarget.value
            // Saved trimmed: a text that differs only by its ends is no change.
            if (next.trim() !== agent.instructions)
              onChange((a) => ({...a, instructions: next}))
          }}
        />
      </FormControlWithLabel>
      <Text fontSize="sm" color="muted" mt={2}>
        {t(
          'The app adds what each action needs, and that part stays as it is: for a flip, its pictures and keywords, the report rules and the format of the answer it reads.',
          {nsSeparator: '!!'}
        )}
      </Text>
      {agent.task === 'joke' &&
        agent.instructions !== DEFAULT_JOKE_INSTRUCTIONS && (
          <SecondaryButton
            mt={3}
            size="sm"
            onClick={() =>
              onChange((a) => ({
                ...a,
                instructions: DEFAULT_JOKE_INSTRUCTIONS,
              }))
            }
          >
            {t('Back to the default instructions')}
          </SecondaryButton>
        )}
    </SettingsSection>
  )
}

function ScheduleSection({agent, catalog, onChange}) {
  const {t} = useTranslation()
  const [budget, setBudget] = useDraft(
    agent.budgetPerDay === null ? '' : String(agent.budgetPerDay)
  )
  const [time, setTime] = useDraft(agent.schedule.time)
  return (
    <SimpleGrid minChildWidth="280px" spacing={6} w="full">
      <SettingsSection title={t('What it reads')} foldId="agent.reads">
        <Text fontSize="sm" color="muted" mb={2}>
          {t('Set by its actions; the model is sent nothing else.')}
        </Text>
        {readsList(agent, catalog, t).map((item) => (
          <React.Fragment key={item}>
            <HDivider />
            <Text py={2}>{item}</Text>
          </React.Fragment>
        ))}
      </SettingsSection>
      <SettingsSection
        title={t('When and how much')}
        foldId="agent.schedule"
        summary={
          {
            validation: t('At each validation'),
            daily: t('Every day'),
            manual: t('When I ask'),
          }[agent.schedule.kind]
        }
      >
        <Stack spacing={4}>
          <FormControlWithLabel label={t('Runs')}>
            <Select
              value={agent.schedule.kind}
              onChange={(e) => {
                const kind = e.target.value
                onChange((a) => ({...a, schedule: {...a.schedule, kind}}))
              }}
            >
              <option value="validation">{t('At each validation')}</option>
              <option value="daily">{t('Every day')}</option>
              <option value="manual">{t('When I ask')}</option>
            </Select>
          </FormControlWithLabel>
          {agent.schedule.kind === 'daily' && (
            <FormControlWithLabel label={t('At')}>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onBlur={(e) => {
                  const next = e.currentTarget.value
                  if (next && next !== agent.schedule.time)
                    onChange((a) => ({
                      ...a,
                      schedule: {...a.schedule, time: next},
                    }))
                }}
              />
            </FormControlWithLabel>
          )}
          <FormControlWithLabel
            label={t(
              'Budget: the most it may spend a day, in iDNA, fees included',
              {nsSeparator: '!!'}
            )}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder={t('None: it spends no iDNA', {nsSeparator: '!!'})}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              onBlur={(e) => {
                const text = e.currentTarget.value.trim()
                const next = text === '' ? null : Number(text)
                // A number the field cannot read (a comma in some languages) reads as '': not "no budget".
                const unreadable = e.currentTarget.validity.badInput
                if (
                  unreadable ||
                  (next !== null && !(Number.isFinite(next) && next >= 0))
                ) {
                  setBudget(
                    agent.budgetPerDay === null
                      ? ''
                      : String(agent.budgetPerDay)
                  )
                  return
                }
                if (next !== agent.budgetPerDay)
                  onChange((a) => ({...a, budgetPerDay: next}))
              }}
            />
          </FormControlWithLabel>
          <Text fontSize="sm" color="muted">
            {t('Model use is billed by its service, not in iDNA.')}
          </Text>
        </Stack>
      </SettingsSection>
    </SimpleGrid>
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
  const isValidation = Boolean(agent.actions.answerFlip)

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
        sentLine={
          // eslint-disable-next-line no-nested-ternary
          isValidation
            ? null
            : agent.provider === 'local'
            ? t('Nothing leaves this computer.')
            : t(
                'What it reads (below) is sent to this service; nothing else.',
                {
                  nsSeparator: '!!',
                }
              )
        }
      />
      {agent.provider !== 'local' && (
        <Text fontSize="sm" color="muted" mt={-4}>
          {t(
            'One key per service, kept on this computer and shared by the agents that use that service.'
          )}
        </Text>
      )}
      <TaskSection agent={agent} onChange={save} />
      <InstructionsSection agent={agent} onChange={save} />
      <ActionsSection
        agent={agent}
        agents={list.agents}
        catalog={catalog}
        onChange={save}
      />
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
