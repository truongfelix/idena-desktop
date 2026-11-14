/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Flex, Heading, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {ErrorAlert, Textarea} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {agentErrorText} from '../settings/agent/api'
import {actionWants} from './catalog'
import {approveAction, declineAction, executors} from './pending-api'

function formatTime(ms) {
  return new Date(ms).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/** One action waiting: who, what, the text it will send (editable when the agent offers it), the three buttons. */
function PendingItem({item}) {
  const {t} = useTranslation()
  const [isEditing, setIsEditing] = React.useState(false)
  const [body, setBody] = React.useState(item.body)
  const [isBusy, setIsBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    if (!isEditing) setBody(item.body)
  }, [item.body, isEditing])

  const canRun = Boolean(executors[item.action])
  const isRunning = item.state === 'running'
  const act = async (call) => {
    setIsBusy(true)
    setError(null)
    try {
      await call()
    } catch (e) {
      setError(agentErrorText(e))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Flex
      as="article"
      borderWidth={1}
      borderColor="blue.050"
      bg="blue.010"
      borderRadius="lg"
      p={5}
      gap={5}
      wrap="wrap"
    >
      <Stack flex="1 1 360px" minW={0} spacing={3}>
        <Flex gap={2} align="baseline" wrap="wrap">
          <Text
            fontSize="sm"
            fontWeight={600}
            color="blue.500"
            textTransform="uppercase"
          >
            {item.agentName}
          </Text>
          <Text fontSize="sm" color="muted">
            {`${actionWants(item.action, t)} · ${formatTime(item.at)}`}
          </Text>
        </Flex>
        {isEditing ? (
          <Textarea
            aria-label={t('The text')}
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        ) : (
          item.body && (
            <Box
              borderWidth={1}
              borderColor="gray.100"
              borderRadius="md"
              bg="surface"
              px={4}
              py={3}
              whiteSpace="pre-line"
              wordBreak="break-word"
            >
              {item.body}
            </Box>
          )
        )}
        {item.detail && (
          <Text fontSize="sm" color="muted">
            {item.detail}
          </Text>
        )}
        {item.error && (
          <Text fontSize="sm" color="red.500">
            {t('Last try failed: {{error}}', {
              error: item.error,
              nsSeparator: '!!',
            })}
          </Text>
        )}
        {!canRun && (
          <Text fontSize="sm" color="muted">
            {t('This version of the app cannot do this action yet.')}
          </Text>
        )}
        {error && <ErrorAlert>{error}</ErrorAlert>}
      </Stack>
      <Stack flex="0 1 180px" justify="flex-end" spacing={2}>
        <PrimaryButton
          isDisabled={!canRun || isRunning}
          isLoading={isBusy || isRunning}
          onClick={() =>
            act(async () => {
              await approveAction(item, isEditing ? body : undefined)
              setIsEditing(false)
            })
          }
        >
          {t('Approve')}
        </PrimaryButton>
        {item.editable && !isEditing && (
          <SecondaryButton
            isDisabled={isBusy || isRunning}
            onClick={() => setIsEditing(true)}
          >
            {t('Edit the text')}
          </SecondaryButton>
        )}
        <SecondaryButton
          isDisabled={isBusy || isRunning}
          onClick={() => act(() => declineAction(item.id))}
        >
          {t('Decline')}
        </SecondaryButton>
      </Stack>
    </Flex>
  )
}

/** To approve, on the Agents page: every action an agent prepared with Ask me, across the agents. */
export function ToApprove({items}) {
  const {t} = useTranslation()
  if (!items) return null
  return (
    <Stack spacing={3} as="section" aria-label={t('To approve')}>
      <Heading as="h2" fontSize="md" fontWeight={600}>
        {t('To approve')}
        <Text as="span" color="muted" fontWeight={400}>
          {` · ${items.length}`}
        </Text>
      </Heading>
      {items.length === 0 ? (
        <Box
          borderWidth={1}
          borderStyle="dashed"
          borderColor="gray.100"
          borderRadius="lg"
          px={5}
          py={4}
          color="muted"
        >
          {t(
            'Nothing to approve. An action an agent may do with Ask me waits here for your click.',
            {nsSeparator: '!!'}
          )}
        </Box>
      ) : (
        items.map((item) => <PendingItem key={item.id} item={item} />)
      )}
    </Stack>
  )
}
