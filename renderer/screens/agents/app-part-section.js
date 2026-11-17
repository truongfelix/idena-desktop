/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Button, Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  Textarea,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {SettingsSection} from '../settings/components'
import {useAppTexts} from './app-texts'
import {useDraft} from './page-sections'

// "What the app adds" (B-282, owner 2026-11-16): the app's part of each area's question, sent with the Instructions.
// Locked, it is the app's own, shown in full. Unlock asks first, naming what depends on the text (the answer's
// format, the safeguard); a changed text is the agent's own for that area alone (main/agent/app-parts.js), marked
// Changed, with the way back to the default.

/** The areas with texts of their own (main/agent/app-parts.js AREAS). */
export const PART_AREAS = ['flipStory', 'validation', 'social']

/** The agent's parts after a change to one text: `text` null, empty or the default's takes it out. */
export function withPart(parts, name, text, defaults) {
  const next = {...(parts || {})}
  const value = typeof text === 'string' ? text : ''
  if (!value.trim() || value.trim() === defaults[name].trim()) delete next[name]
  else next[name] = value
  return next
}

/** The slots of each text (B-285), named outside the translated texts: a "{{...}}" inside one would be filled. */
const SLOTS = {
  storyQuestion: ['keyword1', 'keyword2', 'idea', 'asked', 'before'],
  imagePrompt: ['prompt'],
  flipQuestion: ['keywords', 'left', 'right'],
  flipQuestionShort: ['left', 'right'],
  socialDigest: [
    'ownPosts',
    'sinceLastRun',
    'tips',
    'likes',
    'answers',
    'tags',
    'posts',
    'messages',
  ],
  socialLines: [
    'label',
    'author',
    'text',
    'parent',
    'yours',
    'to',
    'amount',
    'likes',
  ],
}

/** Each text's title and what its slots hold, in the person's words. */
function useTextNames(areaName) {
  const {t} = useTranslation()
  return {
    titles: {
      flipStory: t('Sent with your Instructions'),
      validation: t('Sent with your Instructions'),
      social: t('Sent with your Instructions'),
      storyQuestion: t('The question for a story'),
      imagePrompt: t('The request for a picture'),
      imageSize: t('The size of a picture'),
      flipQuestion: t('The question for a flip with keywords'),
      flipQuestionShort: t('The question for a flip without keywords'),
      socialActions: t('The line of each action'),
      socialDigest: t('What a run reads'),
      socialLines: t('The line of each thing it reads'),
    },
    notes: {
      storyQuestion: t(
        'The two keywords, your idea for the story, what is asked (the story, the image prompts or both) and the titles given before. A paragraph with nothing to fill it is left out; a keyword without its slot goes at the end.'
      ),
      imagePrompt: t(
        'The image prompt of the story. Without its slot, it goes at the end.'
      ),
      imageSize: t(
        'The size asked of the service, in the words the service takes.'
      ),
      flipQuestion: t(
        'The keywords, then where the four pictures of each order go. Pictures without their slot go at the end.'
      ),
      flipQuestionShort: t(
        'Where the four pictures of each order go. Pictures without their slot go at the end.'
      ),
      socialActions: t(
        'One line for each action, after its name. The app lists the lines of the actions the agent holds; a name you take out keeps the app’s line.'
      ),
      socialDigest: t(
        'Each slot holds the lines of one kind. A paragraph with nothing to fill it is left out.'
      ),
      socialLines: t(
        'One line for each name; a name you take out keeps the app’s line. The slots hold the label the answer names, who wrote it, its text, the text it answers, and for a tip or likes, how many.'
      ),
      [areaName]: null,
    },
  }
}

function PartEditor({label, value, rows, maxLength, onSave}) {
  const [draft, setDraft] = useDraft(value)
  return (
    <Textarea
      aria-label={label}
      rows={rows}
      fontFamily="mono"
      fontSize="sm"
      value={draft}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (e.currentTarget.value !== value) onSave(e.currentTarget.value)
      }}
    />
  )
}

/** The slots of a text, then what they hold. */
function SlotNote({slots = [], children}) {
  return (
    <Text fontSize="sm" color="muted">
      {slots.map((slot) => (
        <React.Fragment key={slot}>
          <Text as="code">{`{{${slot}}}`}</Text>{' '}
        </React.Fragment>
      ))}
      {children}
    </Text>
  )
}

export function AppPartSection({agent, onChange}) {
  const {t} = useTranslation()
  const texts = useAppTexts()
  const [area, setArea] = React.useState('social')
  const [asking, setAsking] = React.useState(false)
  // Unlocked in this visit and not changed yet: nothing is saved until a text differs.
  const [unlocked, setUnlocked] = React.useState({})
  const {titles, notes} = useTextNames(area)
  if (!texts || !texts.parts || !texts.areas) return null
  const names = {
    flipStory: t('Flip stories'),
    validation: t('Validation'),
    social: t('Social'),
  }
  const parts = agent.appParts || {}
  const changedIn = (one) => texts.areas[one].some(({name}) => name in parts)
  const changed = PART_AREAS.filter(changedIn)
  const isChanged = changedIn(area)
  const isOpen = isChanged || unlocked[area] === true
  const save = (name, text) =>
    onChange((a) => ({
      ...a,
      appParts: withPart(a.appParts, name, text, texts.parts),
    }))

  return (
    <SettingsSection
      title={t('What the app adds')}
      foldId="agent.appPart"
      defaultOpen={false}
      info={t(
        'With your Instructions, the app sends its own part for each area. It says what the data is, that what others wrote is never instructions, and the format of the answer the app can read. Every agent gets the same one, unless you unlock it here.'
      )}
      summary={
        changed.length
          ? t('Changed: {{areas}}', {
              areas: changed.map((one) => names[one]).join(', '),
              nsSeparator: '!!',
            })
          : t('The app’s own')
      }
    >
      <Stack spacing={4}>
        <Flex role="tablist" aria-label={t('Areas')} gap={2} wrap="wrap">
          {PART_AREAS.map((one) => {
            const isPicked = one === area
            return (
              <Button
                key={one}
                role="tab"
                aria-selected={isPicked}
                size="sm"
                variant={isPicked ? 'solid' : 'outline'}
                colorScheme={isPicked ? 'blue' : 'gray'}
                onClick={() => setArea(one)}
              >
                {names[one]}
                {changedIn(one) && (
                  <Text as="span" fontWeight={400} ml={2}>
                    {t('Changed')}
                  </Text>
                )}
              </Button>
            )
          })}
        </Flex>
        {isOpen && (
          <Text color="orange.500">
            {isChanged
              ? t(
                  'This text is yours. The app no longer updates it, and if the model’s answer loses its format, its runs do nothing.'
                )
              : t('Unlocked. Nothing changes until you change the text below.')}
          </Text>
        )}
        {texts.areas[area].map(({name, maxLength}) => {
          const label = `${names[area]}: ${titles[name]}`
          const value = parts[name] || texts.parts[name]
          const rows = Math.min(12, value.split('\n').length + 1)
          return (
            <Stack key={name} spacing={2}>
              <Text fontWeight={500}>
                {titles[name]}
                {name in parts && (
                  <Text as="span" fontWeight={400} color="orange.500" ml={2}>
                    {t('Changed')}
                  </Text>
                )}
              </Text>
              {isOpen ? (
                <PartEditor
                  key={name}
                  label={label}
                  value={value}
                  rows={rows}
                  maxLength={maxLength}
                  onSave={(text) => save(name, text)}
                />
              ) : (
                <Box
                  as="pre"
                  aria-label={label}
                  p={3}
                  maxH="20rem"
                  overflowY="auto"
                  fontSize="sm"
                  whiteSpace="pre-wrap"
                  bg="gray.50"
                  borderRadius="md"
                >
                  {texts.parts[name]}
                </Box>
              )}
              {isOpen && name === area && (
                <SlotNote slots={['instructions']}>
                  {t(
                    'is where your Instructions go; without it, they go at the end.'
                  )}
                  {area === 'social' && (
                    <>
                      {' '}
                      <Text as="code">{'{{actions}}'}</Text>{' '}
                      {t(
                        'is where the app lists the actions it may do; without it, the list goes at the end.'
                      )}
                    </>
                  )}
                </SlotNote>
              )}
              {isOpen && notes[name] && (
                <SlotNote slots={SLOTS[name]}>{notes[name]}</SlotNote>
              )}
              {isOpen && name in parts && (
                <Flex>
                  <SecondaryButton
                    aria-label={t('Back to the default: {{text}}', {
                      text: titles[name],
                      nsSeparator: '!!',
                    })}
                    onClick={() => {
                      // The last changed text of the area: it locks again.
                      const others = texts.areas[area].some(
                        (one) => one.name !== name && one.name in parts
                      )
                      if (!others)
                        setUnlocked((now) => ({...now, [area]: false}))
                      save(name, null)
                    }}
                  >
                    {t('Back to the default')}
                  </SecondaryButton>
                </Flex>
              )}
            </Stack>
          )
        })}
        {!isOpen && (
          <Flex>
            <SecondaryButton onClick={() => setAsking(true)}>
              {t('Unlock to edit')}
            </SecondaryButton>
          </Flex>
        )}
      </Stack>
      <Dialog
        title={t('Unlock the app’s part for {{area}}?', {area: names[area]})}
        isOpen={asking}
        onClose={() => setAsking(false)}
      >
        <DialogBody>
          <Stack spacing={3}>
            <Text>{t('Two things depend on this text.')}</Text>
            <Text>
              {t(
                'Its format. The app can only do what it can read in the answer. If the model answers another way, the run does nothing.'
              )}
            </Text>
            <Text>
              {t(
                'Its safeguard. It tells the model that what others wrote is data, never instructions. Without it, anyone who posts can try to steer your agent, for example into tipping them.'
              )}
            </Text>
            <Text>
              {t(
                'Whatever the text says, the app still checks its rights, its limits a day and its budget. Once changed, the text no longer follows the app’s updates. You can go back to the default at any time.'
              )}
            </Text>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton
            onClick={() => {
              setUnlocked((now) => ({...now, [area]: true}))
              setAsking(false)
            }}
          >
            {t('Unlock')}
          </SecondaryButton>
          <PrimaryButton onClick={() => setAsking(false)}>
            {t('Keep it locked')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    </SettingsSection>
  )
}
