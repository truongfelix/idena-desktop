/* eslint-disable react/prop-types */
import * as React from 'react'
import {Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {ErrorAlert, Textarea} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {SettingsSection} from '../settings/components'
import {agentErrorText, flipPromptDefault} from '../settings/agent/api'

// The question the validation agent's model gets for each flip (B-235, main/agent/flips.js): the person edits it;
// the two parts the app fills stay as named placeholders, so an edit cannot change the rules' numbers nor the
// answer's format the app reads.

export const FLIP_PROMPT_PARTS = ['{RULES}', '{ANSWER_FORMAT}']

/** The parts missing from a question, or named more than once: none for a question that can be used. */
export const missingParts = (text) =>
  FLIP_PROMPT_PARTS.filter((part) => text.split(part).length - 1 !== 1)

export function FlipQuestionSection({agent, onSave}) {
  const {t} = useTranslation()
  const [fallback, setFallback] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState(null)

  React.useEffect(() => {
    flipPromptDefault().then(setFallback, (e) =>
      setLoadError(agentErrorText(e))
    )
  }, [])
  const saved = agent.flipPrompt || fallback
  React.useEffect(() => {
    setDraft(saved)
  }, [saved])
  if (loadError && !agent.flipPrompt)
    return (
      <SettingsSection title={t('The flip question')}>
        <ErrorAlert>
          {t('The app could not read its flip question ({{message}}).', {
            message: loadError,
          })}
        </ErrorAlert>
      </SettingsSection>
    )
  if (saved === null || draft === null) return null

  const save = async (text) => {
    const missing = missingParts(text)
    if (missing.length) {
      setError(
        t(
          'The question must keep {{parts}}, once each: the app fills them with the rules and the answer it reads.',
          {parts: missing.join(', '), nsSeparator: '!!'}
        )
      )
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      // The app's own question is saved as none: a later version's default then applies.
      await onSave(text === fallback ? '' : text)
    } catch (e) {
      setError(agentErrorText(e))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsSection title={t('The flip question')}>
      <Stack spacing={3}>
        <Text color="muted">
          {t(
            'What the model is asked for each flip of the validation and of the practice test. {RULES} and {ANSWER_FORMAT} are filled by the app: the numbered report rules, and the answer it reads.',
            {nsSeparator: '!!'}
          )}
        </Text>
        <Textarea
          aria-label={t('The flip question')}
          rows={12}
          value={draft}
          maxLength={20000}
          fontFamily="mono"
          fontSize="sm"
          onChange={(e) => setDraft(e.target.value)}
        />
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Flex gap={2} wrap="wrap">
          <PrimaryButton
            isLoading={isSaving}
            isDisabled={draft === saved}
            onClick={() => save(draft)}
          >
            {t('Save the question')}
          </PrimaryButton>
          {(agent.flipPrompt || draft !== fallback) && (
            <SecondaryButton
              isDisabled={isSaving || fallback === null}
              onClick={() => {
                setDraft(fallback)
                setError(null)
                // Only a saved question of its own is saved back; an unsaved edit is just undone.
                if (agent.flipPrompt) save(fallback)
              }}
            >
              {t('Back to default')}
            </SecondaryButton>
          )}
        </Flex>
      </Stack>
    </SettingsSection>
  )
}
