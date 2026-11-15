/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Checkbox, Flex, Stack, Switch, Text, Wrap} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  FormControlWithLabel,
  HDivider,
  Input,
  Select,
  Textarea,
} from '../../shared/components/components'
import {SettingsSection} from '../settings/components'
import {areaNames, readsList} from './catalog'
import {readNumber} from './limit-fields'

// The agent page's sections (B-255): its Instructions, what it reads, when it runs and what it spends. Each says
// what it is for in the ⓘ beside its title, written for any agent; no small print under the fields.

/** A text field saved when it loses the focus, not at each key. */
export function useDraft(value) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  return [draft, setDraft]
}

/** The textarea's grip: a bar under it, dragged up or down to change its height. */
function Grip({target}) {
  const start = React.useRef(null)
  return (
    <Flex
      role="separator"
      aria-orientation="horizontal"
      aria-label="resize"
      h={4}
      mt={1}
      align="center"
      justify="center"
      cursor="ns-resize"
      borderRadius="md"
      _hover={{bg: 'gray.10'}}
      onPointerDown={(e) => {
        const box = target.current
        if (!box) return
        start.current = {y: e.clientY, height: box.offsetHeight}
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const box = target.current
        if (!start.current || !box) return
        const height = Math.max(
          96,
          start.current.height + e.clientY - start.current.y
        )
        box.style.height = `${height}px`
      }}
      onPointerUp={() => {
        start.current = null
      }}
    >
      <Box w={16} h={1} borderRadius="full" bg="muted" />
    </Flex>
  )
}

export function InstructionsSection({agent, onChange}) {
  const {t} = useTranslation()
  const [draft, setDraft] = useDraft(agent.instructions)
  const box = React.useRef(null)
  return (
    <SettingsSection
      title={t('Instructions')}
      foldId="agent.instructions"
      info={t(
        "Your words to the agent: who it is, what it should do and how. They go to the model with each of its actions; the app adds what each action needs, the data it reads and the form of the answer, and that part stays the app's.",
        {nsSeparator: '!!'}
      )}
      summary={
        agent.instructions.trim().split('\n')[0] ||
        t('None yet', {nsSeparator: '!!'})
      }
    >
      <Textarea
        ref={box}
        aria-label={t('Instructions')}
        rows={8}
        resize="none"
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
      <Grip target={box} />
    </SettingsSection>
  )
}

/** The posts' window: none, the last 24 hours, or the last N posts. */
function PostsRead({reads, onChange}) {
  const {t} = useTranslation()
  const [count, setCount] = useDraft(String(reads.posts.count))
  const setPosts = (change) =>
    onChange((a) => ({
      ...a,
      reads: {...a.reads, posts: {...a.reads.posts, ...change}},
    }))
  return (
    <Flex align="center" gap={3} wrap="wrap">
      <Text flex="1 1 160px">{t('Posts')}</Text>
      <Select
        w="auto"
        aria-label={t('Posts')}
        value={reads.posts.window}
        onChange={(e) => setPosts({window: e.target.value})}
      >
        <option value="off">{t('None')}</option>
        <option value="day">{t('The last 24 hours')}</option>
        <option value="count">{t('The last posts')}</option>
      </Select>
      {reads.posts.window === 'count' && (
        <Input
          type="number"
          w="80px"
          min={1}
          max={50}
          aria-label={t('How many posts')}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          onBlur={(e) => {
            const next = readNumber(e.currentTarget.value, {min: 1})
            if (next === null || next > 50) setCount(String(reads.posts.count))
            else if (next !== reads.posts.count) setPosts({count: next})
          }}
        />
      )}
    </Flex>
  )
}

function SwitchRow({label, isChecked, onToggle}) {
  return (
    <Flex align="center" justify="space-between" gap={3}>
      <Text>{label}</Text>
      <Switch
        aria-label={label}
        isChecked={isChecked}
        onChange={(e) => onToggle(e.target.checked)}
      />
    </Flex>
  )
}

/** "What it reads": on Social, the posts' window, its notifications, its messages; and what its actions read. */
export function ReadsSection({agent, catalog, onChange}) {
  const {t} = useTranslation()
  const names = areaNames(t)
  const setRead = (name, value) =>
    onChange((a) => ({...a, reads: {...a.reads, [name]: value}}))
  return (
    <SettingsSection
      title={t('What it reads')}
      foldId="agent.reads"
      info={t(
        'What the model is sent, and nothing else: what you turn on here, and what its actions need. It acts only on what it read. Reading spends nothing.',
        {nsSeparator: '!!'}
      )}
      summary={readsList(agent, catalog, t).join(', ')}
    >
      <Stack spacing={3}>
        <Text fontWeight={500}>{names.social}</Text>
        <PostsRead reads={agent.reads} onChange={onChange} />
        <SwitchRow
          label={t('Notifications: likes, answers and tips to it', {
            nsSeparator: '!!',
          })}
          isChecked={agent.reads.notifications}
          onToggle={(on) => setRead('notifications', on)}
        />
        <SwitchRow
          label={t('Private messages')}
          isChecked={agent.reads.messages}
          onToggle={(on) => setRead('messages', on)}
        />
        <HDivider />
        <Text color="muted">
          {t('Everything it reads: {{list}}', {
            list: readsList(agent, catalog, t).join(', '),
            nsSeparator: '!!',
          })}
        </Text>
      </Stack>
    </SettingsSection>
  )
}

/** The events that run it besides its schedule (profiles.js EVENTS), in words. */
function eventNames(t) {
  return {
    like: t('a like'),
    answer: t('an answer'),
    tip: t('a tip'),
    message: t('a private message'),
  }
}

/** "When and how much": when it runs (schedule, events) and the most it may spend a day. */
export function ScheduleSection({agent, onChange}) {
  const {t} = useTranslation()
  const [budget, setBudget] = useDraft(
    agent.budgetPerDay === null ? '' : String(agent.budgetPerDay)
  )
  const [time, setTime] = useDraft(agent.schedule.time)
  const events = eventNames(t)
  return (
    <SettingsSection
      title={t('When and how much')}
      foldId="agent.schedule"
      info={t(
        "When it runs: on its schedule, and when something comes to it. The budget is the most it may spend a day in iDNA, fees included, on what it does alone; with none, it spends nothing alone. The model's own service bills apart.",
        {nsSeparator: '!!'}
      )}
      summary={
        {
          validation: t('At each validation'),
          hourly: t('Every hour'),
          daily: t('Every day'),
          manual: t('When I ask'),
        }[agent.schedule.kind]
      }
    >
      <Stack spacing={4} maxW="xl">
        <Flex gap={4} wrap="wrap" align="flex-end">
          <FormControlWithLabel label={t('Runs')} flex="1 1 200px">
            <Select
              value={agent.schedule.kind}
              onChange={(e) => {
                const kind = e.target.value
                onChange((a) => ({...a, schedule: {...a.schedule, kind}}))
              }}
            >
              <option value="validation">{t('At each validation')}</option>
              <option value="hourly">{t('Every hour')}</option>
              <option value="daily">{t('Every day')}</option>
              <option value="manual">{t('When I ask')}</option>
            </Select>
          </FormControlWithLabel>
          {agent.schedule.kind === 'daily' && (
            <FormControlWithLabel label={t('At')} w="140px">
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
        </Flex>
        <Stack spacing={2}>
          <Text>{t('Also runs when it gets')}</Text>
          <Wrap spacing={4}>
            {Object.entries(events).map(([id, label]) => (
              <Checkbox
                key={id}
                isChecked={agent.events.includes(id)}
                onChange={(e) => {
                  const on = e.target.checked
                  onChange((a) => ({
                    ...a,
                    events: on
                      ? [...a.events.filter((one) => one !== id), id]
                      : a.events.filter((one) => one !== id),
                  }))
                }}
              >
                {label}
              </Checkbox>
            ))}
          </Wrap>
        </Stack>
        <FormControlWithLabel
          label={t('Budget a day, in iDNA', {nsSeparator: '!!'})}
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder={t('None', {nsSeparator: '!!'})}
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
                  agent.budgetPerDay === null ? '' : String(agent.budgetPerDay)
                )
                return
              }
              if (next !== agent.budgetPerDay)
                onChange((a) => ({...a, budgetPerDay: next}))
            }}
          />
        </FormControlWithLabel>
      </Stack>
    </SettingsSection>
  )
}
