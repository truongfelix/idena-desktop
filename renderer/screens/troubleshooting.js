/* eslint-disable react/prop-types */
import {
  Button,
  Flex,
  Heading,
  Stack,
  Text,
  useBoolean,
  useDisclosure,
  VisuallyHidden,
} from '@chakra-ui/react'
import React from 'react'
import {useTranslation} from 'react-i18next'
import {NODE_COMMAND, NODE_EVENT} from '../../main/channels'
import {PrimaryButton, SecondaryButton} from '../shared/components/button'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  HDivider,
} from '../shared/components/components'
import {useNodeState} from '../shared/providers/node-context'

export function TroubleshootingScreen() {
  const {t} = useTranslation()

  const {restart, update} = useTroubleshooting()

  const {stopReason} = useNodeState()

  const resetDisclosure = useDisclosure()

  return (
    <Stack spacing="6">
      <Stack spacing="1">
        <Heading as="h2" fontSize="lg" fontWeight={500}>
          {t('Ooops, something went wrong')}
        </Heading>
        <Text color="muted" fontSize="mdx">
          {t(`The built-in node is not available. Here's how to fix it.`, {
            nsSeparator: '|',
          })}
        </Text>
      </Stack>
      <NodeStopReason reason={stopReason} />
      <TroubleshootingList>
        <TroubleshootingListItem
          title={t('1. Restart')}
          description={t(
            'Restart the built-in node. If it does not solve the problem try to restart your computer.'
          )}
          ActionComponent={
            <TroubleshootingActionButton onClick={restart}>
              {t('Restart node')}
            </TroubleshootingActionButton>
          }
        />
        <TroubleshootingListItem
          title={t('2. Update')}
          description={t('Download the latest version of the Idena node.')}
          ActionComponent={
            <TroubleshootingActionButton onClick={update}>
              {t('Update node')}
            </TroubleshootingActionButton>
          }
        />
        <TroubleshootingListItem
          title={t('3. Reset')}
          description={t(
            'Delete the blockchain data and re-sync it from scratch. This will not affect your private key.'
          )}
          ActionComponent={
            <TroubleshootingActionButton
              variant="danger"
              onClick={resetDisclosure.onOpen}
            >
              {t('Reset node')}
            </TroubleshootingActionButton>
          }
        />
        <VisuallyHidden />
      </TroubleshootingList>

      <ResetNodeConfirmationDialog {...resetDisclosure} />
    </Stack>
  )
}

/** The node's known causes (main/node-stop-reason.js), said in the user's language. */
function useStopCauseText() {
  const {t} = useTranslation()
  return {
    'rpc-port-taken': t(
      'Another program uses the port the app talks to the node on: close it (another Idena node, an older app still running), or restart the computer.',
      {nsSeparator: '|'}
    ),
    'node-port-taken': t(
      'Another program uses the node port: close it (another Idena node), or pick another node port in the Settings.',
      {nsSeparator: '|'}
    ),
    'port-taken': t(
      'Another program uses a port the node needs: close it (another Idena node), or restart the computer.',
      {nsSeparator: '|'}
    ),
    'data-folder-in-use': t(
      'Another node uses this node folder: close it (another Idena app or node still running), or restart the computer.',
      {nsSeparator: '|'}
    ),
    'config-broken': t(
      'The node cannot read its configuration file (config.json in the node folder): fix it, or delete it to use the default settings.',
      {nsSeparator: '|'}
    ),
  }
}

// Known causes the Reset button cannot fix: the screen says so, before the user deletes the chain for nothing.
const CAUSES_RESET_KEEPS = [
  'rpc-port-taken',
  'node-port-taken',
  'port-taken',
  'data-folder-in-use',
  'config-broken',
]

export function NodeStopReason({reason}) {
  const {t} = useTranslation()
  const causeText = useStopCauseText()
  if (!reason || (!reason.cause && !reason.line)) return null
  return (
    <Stack spacing="2" w="md" data-testid="node-stop-reason">
      <Text fontWeight={500}>{t('Why the node stopped')}</Text>
      {reason.cause && causeText[reason.cause] && (
        <Text>{causeText[reason.cause]}</Text>
      )}
      {CAUSES_RESET_KEEPS.includes(reason.cause) && (
        <Text color="muted">
          {t(
            'Reset node does not fix this: it would only sync the chain again.',
            {nsSeparator: '|'}
          )}
        </Text>
      )}
      {reason.line && (
        <Text
          color="muted"
          fontFamily="mono"
          fontSize="sm"
          wordBreak="break-word"
          userSelect="text"
        >
          {reason.line}
        </Text>
      )}
    </Stack>
  )
}

function TroubleshootingList({children}) {
  return (
    <Stack
      spacing={0}
      divider={<HDivider borderColor="gray.500" borderRadius={1} />}
    >
      {children}
    </Stack>
  )
}

function TroubleshootingListItem({title, description, ActionComponent}) {
  return (
    <Flex justify="space-between" align="center" w="md">
      <Stack spacing="1" py="6">
        <Text lineHeight="5" fontWeight={500}>
          {title}
        </Text>
        <Text color="muted" lineHeight="5" w="80">
          {description}
        </Text>
      </Stack>
      {ActionComponent}
    </Flex>
  )
}

/** @param {import('@chakra-ui/react').ButtonProps | {variant: "primary" | "danger"}} */
function TroubleshootingActionButton({variant = 'primary', ...props}) {
  return <Button variant={variant} lineHeight="5" w={120} {...props} />
}

function ResetNodeConfirmationDialog(props) {
  const {t} = useTranslation()

  const {reset} = useTroubleshooting()

  const [isPending, {on: setIsPendingOn, off: setIsPendingOff}] = useBoolean()

  React.useEffect(() => {
    const handleNodeEvent = (_, event) => {
      switch (event) {
        case 'troubleshooting-reset-node':
          return setIsPendingOff()
        default:
          break
      }
    }

    return global.ipcRenderer.on(NODE_EVENT, handleNodeEvent)
  }, [setIsPendingOff])

  return (
    <Dialog title={t('Are you sure?')} {...props}>
      <DialogBody>
        {t('It may take time to re-sync the blockchain data from scratch.')}
      </DialogBody>
      <DialogFooter>
        {/* eslint-disable-next-line react/destructuring-assignment */}
        <SecondaryButton onClick={props.onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          isLoading={isPending}
          onClick={() => {
            setIsPendingOn()
            reset()
          }}
        >
          {t(`Yes, I'm sure`)}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

function useTroubleshooting() {
  const restart = () => {
    global.ipcRenderer.send(NODE_COMMAND, 'troubleshooting-restart-node')
  }

  const update = () => {
    global.ipcRenderer.send(NODE_COMMAND, 'troubleshooting-update-node')
  }

  const reset = () => {
    global.ipcRenderer.send(NODE_COMMAND, 'troubleshooting-reset-node')
  }

  return {
    restart,
    update,
    reset,
  }
}
