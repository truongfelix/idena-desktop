/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Button, Checkbox, Flex, Stack, Text, Wrap} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  FormControlWithLabel,
  Input,
  Select,
  Textarea,
} from '../../shared/components/components'
import {SettingsSection} from '../settings/components'
import {useAppTexts} from './app-texts'

// The agent page's sections (B-255): its Instructions, when it runs and what it spends (what it reads is among its
// actions since B-262). Each says
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
        "Your words to the agent: who it is, what it should do and how. They go to the model with each of its actions; the app adds only the data each action reads and the form of the answer, shown in each action's ⓘ.",
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
      <Suggestions agent={agent} onChange={onChange} />
    </SettingsSection>
  )
}

const isHeld = (agent, ids) =>
  ids.some((id) => agent.actions[id] && agent.actions[id].level !== 'off')

/**
 * The suggested Instructions of the actions the agent holds (B-268): the app's former texts, added at the end of the
 * Instructions for the person to keep, edit or delete. One already there is not offered again.
 */
function Suggestions({agent, onChange}) {
  const {t} = useTranslation()
  const texts = useAppTexts()
  if (!texts) return null
  const offers = [
    [['flipStory'], 'flipStory', t('Add the suggestion for flip stories')],
    [
      ['answerFlip', 'report'],
      'answerFlip',
      t('Add the suggestion for the validation'),
    ],
    [
      ['post', 'reply', 'like', 'message', 'tip'],
      'social',
      t('Add the suggestion for Social'),
    ],
  ].filter(
    ([ids, key]) =>
      isHeld(agent, ids) &&
      texts.suggestions[key] &&
      !agent.instructions.includes(texts.suggestions[key].split('\n')[0])
  )
  if (!offers.length) return null
  return (
    <Wrap spacing={4} mt={2}>
      {offers.map(([, key, label]) => (
        <Button
          key={key}
          size="sm"
          variant="link"
          colorScheme="blue"
          onClick={() =>
            onChange((a) => ({
              ...a,
              instructions: [a.instructions.trim(), texts.suggestions[key]]
                .filter(Boolean)
                .join('\n\n'),
            }))
          }
        >
          {label}
        </Button>
      ))}
    </Wrap>
  )
}

/** Whether the agent holds actions on what others wrote (reply, like, tip, message) but reads nothing of it. */
export function nothingToActOn({actions, reads}) {
  const acting = ['reply', 'like', 'tip', 'message'].some(
    (name) => actions[name] && actions[name].level !== 'off'
  )
  return (
    acting &&
    reads.posts.window === 'off' &&
    !reads.notifications &&
    !reads.messages
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

/** "When it runs": its schedule and the events that start a run (what it spends is on its actions, B-269). */
export function ScheduleSection({agent, onChange}) {
  const {t} = useTranslation()
  const [time, setTime] = useDraft(agent.schedule.time)
  const events = eventNames(t)
  return (
    <SettingsSection
      title={t('When it runs')}
      foldId="agent.schedule"
      info={t(
        'On its schedule, and when something comes to it. What it may spend is set on each action that costs money.',
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
          <Text>
            {t(
              'Also runs when it gets (what it reads: its notifications, its private messages)',
              {nsSeparator: '!!'}
            )}
          </Text>
          <Wrap spacing={4}>
            {Object.entries(events).map(([id, label]) => (
              <Checkbox
                key={id}
                // An event it does not read could start a run that shows it nothing (B-255).
                isDisabled={
                  !(id === 'message'
                    ? agent.reads.messages
                    : agent.reads.notifications)
                }
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
      </Stack>
    </SettingsSection>
  )
}
