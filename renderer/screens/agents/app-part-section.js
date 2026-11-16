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

/** The areas with a part of their own (main/agent/app-parts.js PARTS). */
export const PART_AREAS = ['flipStory', 'validation', 'social']

/** The agent's parts after a change to one area: `text` null, empty or the default's takes it out. */
export function withPart(parts, area, text, defaults) {
  const next = {...(parts || {})}
  const value = typeof text === 'string' ? text : ''
  if (!value.trim() || value.trim() === defaults[area].trim()) delete next[area]
  else next[area] = value
  return next
}

function PartEditor({label, value, onSave}) {
  const [draft, setDraft] = useDraft(value)
  return (
    <Textarea
      aria-label={label}
      rows={12}
      fontFamily="mono"
      fontSize="sm"
      value={draft}
      maxLength={20000}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (e.currentTarget.value !== value) onSave(e.currentTarget.value)
      }}
    />
  )
}

export function AppPartSection({agent, onChange}) {
  const {t} = useTranslation()
  const texts = useAppTexts()
  const [area, setArea] = React.useState('social')
  const [asking, setAsking] = React.useState(false)
  // Unlocked in this visit and not changed yet: nothing is saved until the text differs.
  const [unlocked, setUnlocked] = React.useState({})
  if (!texts || !texts.parts) return null
  const names = {
    flipStory: t('Flip stories'),
    validation: t('Validation'),
    social: t('Social'),
  }
  const parts = agent.appParts || {}
  const changed = PART_AREAS.filter((one) => one in parts)
  const isChanged = area in parts
  const isOpen = isChanged || unlocked[area] === true
  const label = t('The app’s part for {{area}}', {area: names[area]})
  const save = (text) =>
    onChange((a) => ({
      ...a,
      appParts: withPart(a.appParts, area, text, texts.parts),
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
                {one in parts && (
                  <Text as="span" fontWeight={400} ml={2}>
                    {t('Changed')}
                  </Text>
                )}
              </Button>
            )
          })}
        </Flex>
        {isOpen ? (
          <Stack spacing={3}>
            <Text color="orange.500">
              {isChanged
                ? t(
                    'This text is yours. The app no longer updates it, and if the model’s answer loses its format, its runs do nothing.'
                  )
                : t(
                    'Unlocked. Nothing changes until you change the text below.'
                  )}
            </Text>
            <PartEditor
              key={area}
              label={label}
              value={parts[area] || texts.parts[area]}
              onSave={save}
            />
            {/* The slots are named outside the texts: a "{{...}}" inside one would be read as a value to fill. */}
            <Text fontSize="sm" color="muted">
              <Text as="code">{'{{instructions}}'}</Text>{' '}
              {t(
                'is where your Instructions go; without it, they go at the end.'
              )}
              {area === 'social' && (
                <>
                  {' '}
                  <Text as="code">{'{{actions}}'}</Text>{' '}
                  {t('is where the app lists the actions it may do.')}
                </>
              )}
            </Text>
            <Flex>
              <SecondaryButton
                onClick={() => {
                  setUnlocked((now) => ({...now, [area]: false}))
                  if (isChanged) save(null)
                }}
              >
                {t('Back to the default')}
              </SecondaryButton>
            </Flex>
          </Stack>
        ) : (
          <Stack spacing={3}>
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
              {texts.parts[area]}
            </Box>
            <Flex>
              <SecondaryButton onClick={() => setAsking(true)}>
                {t('Unlock to edit')}
              </SecondaryButton>
            </Flex>
          </Stack>
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
