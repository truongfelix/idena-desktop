/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Button, Flex, SimpleGrid, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {
  FormControlWithLabel,
  Input,
  Select,
  WarningAlert,
} from '../../../shared/components/components'
import {SettingsSection} from '../components'
import {REPORT_REASONS} from '../../validation/practice'

/** The largest longest answer kept (main/agent/settings.js MAX_ANSWER_TOKENS). */
const MAX_ANSWER_TOKENS = 128000

/** Where the model runs, the choices of an agent page (main/agent/settings.js PROVIDERS). */
function useProviders() {
  const {t} = useTranslation()
  return [
    {
      id: 'local',
      label: t('On this computer'),
      hint: t('Ollama, LM Studio, llama.cpp'),
    },
    {
      id: 'openai',
      label: t('OpenAI-compatible service'),
      hint: t('Any provider with that API'),
    },
    {id: 'anthropic', label: t('Anthropic API'), hint: t('Claude models')},
  ]
}

/** One field saved when it loses the focus (or on Enter), not at each key. */
function SavedOnBlurInput({value, onSave, ...props}) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  // The input's own value: a blur right after the last key can come before React renders the draft.
  const save = (e) => {
    const next = e.currentTarget.value.trim()
    if (next !== value) onSave(next)
  }
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      // Enter leaves the field: its blur saves, once.
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      {...props}
    />
  )
}

/** A whole number of tokens from 1, else null: what the main process keeps (settings.js normalizeMaxTokens). */
function readTokens(text) {
  const number = Number(text.replace(/[\s,._]/gu, ''))
  return text.trim() && Number.isInteger(number) && number >= 1
    ? Math.min(number, MAX_ANSWER_TOKENS)
    : null
}

/** The longest answer's field: on leaving it, it shows what was saved (empty for a number it cannot read). */
function TokensInput({value, onSave, ...props}) {
  const shown = value ? String(value) : ''
  const [draft, setDraft] = React.useState(shown)
  React.useEffect(() => setDraft(shown), [shown])
  return (
    <Input
      value={draft}
      inputMode="numeric"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const next = readTokens(e.currentTarget.value)
        setDraft(next ? String(next) : '')
        if (next !== (value || null)) onSave(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      {...props}
    />
  )
}

/**
 * The model's longest answer and effort (B-265), for an agent (the single agent's settings have none). An empty field
 * leaves the app's choice for each task, and the model's default effort.
 */
function AnswerFields({settings, onChange}) {
  const {t} = useTranslation()
  const efforts =
    settings.provider === 'anthropic'
      ? ['low', 'medium', 'high', 'xhigh', 'max']
      : ['low', 'medium', 'high']
  const effortLabel = {
    low: t('Low'),
    medium: t('Medium'),
    high: t('High'),
    xhigh: t('Very high'),
    max: t('Highest'),
  }
  return (
    <Stack spacing={2}>
      <SimpleGrid columns={[1, 2]} spacing={4}>
        <FormControlWithLabel label={t('Longest answer, in tokens')}>
          <TokensInput
            value={settings.maxTokens}
            placeholder={t("The app's choice")}
            onSave={(maxTokens) => onChange((s) => ({...s, maxTokens}))}
          />
        </FormControlWithLabel>
        <FormControlWithLabel label={t('Effort')}>
          <Select
            value={efforts.includes(settings.effort) ? settings.effort : ''}
            onChange={(e) => {
              const effort = e.target.value
              onChange((s) => ({...s, effort}))
            }}
          >
            <option value="">{t("The model's default")}</option>
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effortLabel[effort]}
              </option>
            ))}
          </Select>
        </FormControlWithLabel>
      </SimpleGrid>
      <Text color="muted" fontSize="sm">
        {t(
          'More effort: better answers to hard questions, more tokens billed. An answer that reaches the longest answer is cut short, and Activity says so. A model without effort may refuse it (Activity shows its error) or ignore it.',
          {nsSeparator: '!!'}
        )}
      </Text>
    </Stack>
  )
}

function KeyField({status, onSetKey, onClearKey}) {
  const {t} = useTranslation()
  const [key, setKey] = React.useState('')
  if (!status.keychain.available)
    return (
      <WarningAlert>
        {t(
          'This computer has no keychain the app can use, so it cannot keep an API key. Use a model on this computer, or set up the system keychain.'
        )}
      </WarningAlert>
    )
  if (status.hasKey)
    return (
      <Flex align="center" justify="space-between" gap={4} wrap="wrap">
        <Text color="muted">
          {t("A key is kept in this computer's keychain.")}
        </Text>
        <SecondaryButton onClick={onClearKey}>
          {t('Remove the key')}
        </SecondaryButton>
      </Flex>
    )
  return (
    <Stack spacing={3}>
      {status.keyElsewhere && (
        <Flex align="center" justify="space-between" gap={4} wrap="wrap">
          <Text color="muted">
            {t(
              "A key saved for another service or address is still in this computer's keychain."
            )}
          </Text>
          <SecondaryButton onClick={onClearKey}>
            {t('Remove the key')}
          </SecondaryButton>
        </Flex>
      )}
      <Flex align="flex-end" gap={2}>
        <FormControlWithLabel
          label={t(
            "API key: kept in this computer's keychain, never in the app's files",
            {
              nsSeparator: '!!',
            }
          )}
          flex={1}
        >
          <Input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </FormControlWithLabel>
        <PrimaryButton
          isDisabled={!key.trim()}
          onClick={async () => {
            if (await onSetKey(key)) setKey('')
          }}
        >
          {t('Save the key')}
        </PrimaryButton>
      </Flex>
    </Stack>
  )
}

/**
 * After a practice test, each long-session flip to report or that the model gave a reason for: the right reason, the
 * model's reasons with how sure it was, and whether that made a report (each reason has its own threshold).
 */
function PracticeReports({reports}) {
  const {t} = useTranslation()
  if (!reports || !reports.length) return null
  const reason = (n) => t(REPORT_REASONS[n] ?? '')
  const outcome = ({reportReason, reported}) => {
    if (reportReason && reported) return [t('Rightly reported'), 'green.500']
    if (reportReason) return [t('Missed'), 'red.500']
    if (reported) return [t('Reported a good flip'), 'red.500']
    return [t('Not reported'), 'green.500']
  }
  return (
    <Stack spacing={2} fontSize="sm">
      <Text fontWeight={500}>{t('Reports, flip by flip')}</Text>
      {reports.map((report, i) => {
        const [label, color] = outcome(report)
        return (
          <Box key={i}>
            <Text>
              <Text as="span" fontWeight={500}>
                {report.keywords.join(' / ')}
              </Text>
              <Text as="span" color={color}>
                {` · ${label}`}
              </Text>
            </Text>
            <Text color="muted">
              {report.reportReason
                ? t('To report for {{reason}}', {
                    reason: reason(report.reportReason),
                  })
                : t('A good flip')}
            </Text>
            <Text color="muted">
              {report.reasons.length
                ? t('The model said {{reasons}}', {
                    reasons: report.reasons
                      .map(
                        ({reason: n, confidence}) =>
                          `${reason(n)} (${Math.round(confidence * 100)}%)`
                      )
                      .join(', '),
                  })
                : t('The model saw no rule broken')}
            </Text>
          </Box>
        )
      })}
    </Stack>
  )
}

/**
 * The Model section: where it runs, its address and name, the key of a hosted one, the practice test (`test`, for an
 * agent answering the validation; none otherwise). `sentLine` says what a hosted service is sent; with `info` (an ⓘ
 * beside the title, B-255), no line is shown under the section.
 */
export function ModelSection({
  status,
  onChange,
  onSetKey,
  onClearKey,
  test,
  sentLine,
  title,
  info,
}) {
  const {t} = useTranslation()
  const providers = useProviders()
  const {settings} = status
  const isLocal = settings.provider === 'local'

  return (
    <SettingsSection
      title={title || t('Model')}
      info={info}
      foldId="agent.connection"
      summary={[
        (providers.find(({id}) => id === settings.provider) || {}).label,
        settings.model,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <Stack spacing={5}>
        <SimpleGrid columns={[1, 3]} spacing={2} role="radiogroup">
          {providers.map(({id, label, hint}) => (
            <Button
              key={id}
              role="radio"
              aria-checked={settings.provider === id}
              variant="outline"
              h="auto"
              py={3}
              px={4}
              justifyContent="flex-start"
              textAlign="left"
              whiteSpace="normal"
              borderWidth={settings.provider === id ? 2 : 1}
              borderColor={settings.provider === id ? 'blue.500' : 'gray.100'}
              onClick={() =>
                settings.provider !== id &&
                // Its effort too: another service takes other efforts (B-265).
                onChange((s) => ({
                  ...s,
                  provider: id,
                  address: '',
                  ...('effort' in s ? {effort: ''} : {}),
                }))
              }
            >
              <Box>
                <Text fontWeight={500}>{label}</Text>
                <Text fontSize="sm" color="muted" fontWeight={400}>
                  {hint}
                </Text>
              </Box>
            </Button>
          ))}
        </SimpleGrid>
        <SimpleGrid columns={[1, 2]} spacing={4}>
          <FormControlWithLabel label={t('Address')}>
            <SavedOnBlurInput
              value={settings.address}
              onSave={(address) => onChange((s) => ({...s, address}))}
            />
          </FormControlWithLabel>
          <FormControlWithLabel label={t('Model')}>
            <SavedOnBlurInput
              value={settings.model}
              placeholder={isLocal ? 'qwen2.5vl:7b' : ''}
              onSave={(model) => onChange((s) => ({...s, model}))}
            />
          </FormControlWithLabel>
        </SimpleGrid>
        {'effort' in settings && (
          <AnswerFields settings={settings} onChange={onChange} />
        )}
        {settings.provider !== 'anthropic' &&
          settings.actions &&
          settings.actions.flipStory && (
            <FormControlWithLabel
              label={t('Image model, for the pictures of flip stories')}
            >
              <SavedOnBlurInput
                value={settings.imageModel || ''}
                placeholder={t('None: the prompts are copied by hand', {
                  nsSeparator: '!!',
                })}
                onSave={(imageModel) => onChange((s) => ({...s, imageModel}))}
              />
            </FormControlWithLabel>
          )}
        {!isLocal && (
          <KeyField
            status={status}
            onSetKey={onSetKey}
            onClearKey={onClearKey}
          />
        )}
        {test && (
          <Flex align="center" gap={4} wrap="wrap">
            {test.isRunning ? (
              <SecondaryButton onClick={test.stop}>
                {t('Stop the test')}
              </SecondaryButton>
            ) : (
              <PrimaryButton isDisabled={!settings.model} onClick={test.start}>
                {t('Test on the practice flips')}
              </PrimaryButton>
            )}
            <Text color="muted">{test.line}</Text>
          </Flex>
        )}
        {test && <PracticeReports reports={test.reports} />}
        {!info && (
          <Text color="muted" fontSize="sm">
            {sentLine ||
              (isLocal
                ? t('The flip pictures stay on this computer.')
                : t(
                    'During a validation, the flip pictures and keywords are sent to this service. They become public on the chain after the ceremony anyway; nothing else is sent.'
                  ))}
          </Text>
        )}
      </Stack>
    </SettingsSection>
  )
}
