/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Button, Flex, SimpleGrid, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {
  FormControlWithLabel,
  Input,
  WarningAlert,
} from '../../../shared/components/components'
import {SettingsSection} from '../components'

/** Where the model runs, the choices of Settings › Agent (main/agent/settings.js PROVIDERS). */
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
      onKeyDown={(e) => {
        if (e.key === 'Enter') save(e)
      }}
      {...props}
    />
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

/** The Model section: where it runs, its address and name, the key of a hosted one, the practice test. */
export function ModelSection({status, onChange, onSetKey, onClearKey, test}) {
  const {t} = useTranslation()
  const providers = useProviders()
  const {settings} = status
  const isLocal = settings.provider === 'local'

  return (
    <SettingsSection title={t('Model')}>
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
                onChange((s) => ({...s, provider: id, address: ''}))
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
        {!isLocal && (
          <KeyField
            status={status}
            onSetKey={onSetKey}
            onClearKey={onClearKey}
          />
        )}
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
        <Text color="muted" fontSize="sm">
          {isLocal
            ? t('The flip pictures stay on this computer.')
            : t(
                'During a validation, the flip pictures and keywords are sent to this service. They become public on the chain after the ceremony anyway; nothing else is sent.'
              )}
        </Text>
      </Stack>
    </SettingsSection>
  )
}
