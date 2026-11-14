/* eslint-disable react/prop-types */
import * as React from 'react'
import {useRouter} from 'next/router'
import {Box, Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  ErrorAlert,
  HDivider,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {
  agentErrorText,
  exportAgentFile,
  importAgentFile,
  previewAgentFile,
} from '../settings/agent/api'
import {
  actionName,
  budgetLine,
  connectionLine,
  levelLabel,
  runsLine,
} from './catalog'

// An agent as a file (B-243, "like skills"): Export saves one agent (never its key); Import an agent shows what a
// file holds and what it asks for, then adds it off, each action Off, for the person to turn on.

const MAX_IMPORT_BYTES = 200000

/** Saves the agent's file, as a download (the app asks where). */
export async function saveAgentFile(agentId) {
  const {fileName, text} = await exportAgentFile(agentId)
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/** What an asked action says: its level, and its limit when it has one. */
function askedLine(row, t) {
  const level = levelLabel(row.level, t)
  return row.limit === null || row.limit === undefined
    ? level
    : t('{{level}}, limit {{limit}}', {level, limit: row.limit})
}

function ImportDialog({preview, onCancel, onAdd, isAdding, error}) {
  const {t} = useTranslation()
  const [showInstructions, setShowInstructions] = React.useState(false)
  const {agent, asked, dropped, hasKey} = preview
  const fact = (label, value) => (
    <Flex gap={4}>
      <Text color="muted" w={28} flexShrink={0}>
        {label}
      </Text>
      <Text minW={0}>{value}</Text>
    </Flex>
  )
  return (
    <Dialog title={t('Import an agent')} isOpen onClose={onCancel} size="lg">
      <DialogBody>
        <Stack spacing={4}>
          <Text fontSize="lg" fontWeight={600}>
            {agent.name}
          </Text>
          <Stack spacing={2}>
            {fact(
              t('Instructions'),
              <SecondaryButton
                size="sm"
                onClick={() => setShowInstructions(!showInstructions)}
              >
                {showInstructions ? t('Hide them') : t('Read them')}
              </SecondaryButton>
            )}
            {showInstructions && (
              <Box
                borderWidth={1}
                borderColor="gray.100"
                borderRadius="md"
                p={3}
                maxH="48"
                overflowY="auto"
                whiteSpace="pre-wrap"
                fontSize="sm"
              >
                {agent.instructions || t('None')}
              </Box>
            )}
            {fact(t('Runs'), runsLine(agent, t))}
            {fact(t('Budget'), budgetLine(agent, t))}
            {fact(t('Model'), connectionLine(agent, t))}
          </Stack>
          <Text fontSize="sm" color="muted">
            {agent.provider === 'local' || hasKey
              ? t(
                  'The file holds no key: it uses the one saved on this computer for its service.',
                  {nsSeparator: '!!'}
                )
              : t(
                  'The file holds no key, and none is saved on this computer for its service: add it on the agent page.',
                  {nsSeparator: '!!'}
                )}
          </Text>
          <Stack spacing={1}>
            <Text fontWeight={600}>{t('It asks for these actions')}</Text>
            <Text fontSize="sm" color="muted">
              {t(
                'All start Off. Turn each one on yourself, on the agent page, once you have read its instructions.'
              )}
            </Text>
            {Object.keys(asked).length === 0 && (
              <Text color="muted">{t('None')}</Text>
            )}
            {Object.entries(asked).map(([name, row]) => (
              <React.Fragment key={name}>
                <HDivider />
                <Flex py={2} justify="space-between" align="center" gap={3}>
                  <Box>
                    <Text>{actionName(name, t)}</Text>
                    <Text fontSize="sm" color="muted">
                      {t('Asked for: {{what}}', {
                        what: askedLine(row, t),
                        nsSeparator: '!!',
                      })}
                    </Text>
                  </Box>
                  <Text
                    fontSize="xs"
                    fontWeight={600}
                    color="muted"
                    borderWidth={1}
                    borderColor="gray.100"
                    borderRadius="md"
                    px={2}
                    py={1}
                  >
                    {t('Off')}
                  </Text>
                </Flex>
              </React.Fragment>
            ))}
            {dropped.length > 0 && (
              <Text fontSize="sm" color="muted" pt={2}>
                {t(
                  'Not added: {{actions}}. Another agent of yours answers the validation.',
                  {
                    actions: dropped
                      .map((name) => actionName(name, t))
                      .join(', '),
                    nsSeparator: '!!',
                  }
                )}
              </Text>
            )}
          </Stack>
          {error && <ErrorAlert>{error}</ErrorAlert>}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onCancel}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton isLoading={isAdding} onClick={onAdd}>
          {t('Add the agent')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** Import an agent: a file chosen, what it holds shown, then added off. */
export function ImportAgent({onError}) {
  const {t} = useTranslation()
  const router = useRouter()
  const fileRef = React.useRef()
  const [file, setFile] = React.useState(null)
  const [isAdding, setIsAdding] = React.useState(false)
  const [error, setError] = React.useState(null)

  const read = async (chosen) => {
    try {
      if (chosen.size > MAX_IMPORT_BYTES)
        throw new Error(t('the file is too large'))
      const text = await chosen.text()
      setError(null)
      setFile({text, preview: await previewAgentFile(text)})
    } catch (e) {
      onError(t('Import failed ({{message}}).', {message: agentErrorText(e)}))
    }
  }

  return (
    <>
      <SecondaryButton onClick={() => fileRef.current?.click()}>
        {t('Import an agent')}
      </SecondaryButton>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        aria-label={t('Import an agent')}
        style={{display: 'none'}}
        onChange={(e) => {
          const [chosen] = e.target.files || []
          e.target.value = ''
          if (chosen) read(chosen)
        }}
      />
      {file && (
        <ImportDialog
          preview={file.preview}
          isAdding={isAdding}
          error={error}
          onCancel={() => setFile(null)}
          onAdd={async () => {
            setIsAdding(true)
            try {
              const {savedId} = await importAgentFile(file.text)
              setFile(null)
              router.push(`/agents/view?id=${savedId}`)
            } catch (e) {
              setError(agentErrorText(e))
            } finally {
              setIsAdding(false)
            }
          }}
        />
      )}
    </>
  )
}
