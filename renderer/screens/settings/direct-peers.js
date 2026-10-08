/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Stack, Text, useClipboard} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  FormLabel,
  Input,
} from '../../shared/components/components'
import {callRpc} from '../../shared/utils/utils'
import {useInterval} from '../../shared/hooks/use-interval'
import {useNodeState} from '../../shared/providers/node-context'
import {useSettingsState} from '../../shared/providers/settings-context'
import {
  MAX_DIRECT_PEERS,
  cleanDirectPeers,
  cleanPeerName,
  directPeerProblem,
  ownPeerId,
  parsePeerCode,
  peerCode,
  shortPeerId,
} from '../../../main/direct-peers'
import {directPeerState} from './advanced-settings'

/**
 * The direct peers in Advanced settings (main/direct-peers.js), as in the phone app: the node's own peer code to
 * copy, the nodes kept (each with whether it is connected), and a dialog to add one from its code. `onSave`
 * stores the settings given and asks for the restart: the node takes the list at its start.
 */
export function DirectPeersSettings({isDisabled, description, onSave}) {
  const {t} = useTranslation()
  const settings = useSettingsState()
  const {nodeStarted, nodeOptions: running} = useNodeState()
  const peers = cleanDirectPeers(settings.directPeers)

  const [ownId, setOwnId] = React.useState(null)
  const [peerIds, setPeerIds] = React.useState(null)
  const [isAdding, setIsAdding] = React.useState(false)
  const [isNaming, setIsNaming] = React.useState(false)
  const [removing, setRemoving] = React.useState(null)

  // The node's own id and its peers, every 5 s while the page is open.
  useInterval(
    async () => {
      try {
        const [address, list] = await Promise.all([
          callRpc('net_ipfsAddress'),
          callRpc('net_peers'),
        ])
        setOwnId(ownPeerId(address))
        setPeerIds(new Set((list || []).map((peer) => peer.id)))
      } catch {
        setPeerIds(null)
      }
    },
    nodeStarted && !isDisabled ? 5000 : null,
    true
  )

  const code = ownId ? peerCode(ownId, settings.ownPeerName) : ''
  const {onCopy, hasCopied} = useClipboard(code)

  const savePeers = (list) => onSave('Direct peers', {directPeers: list})

  return (
    <Stack spacing={2}>
      <Box>
        <Text fontWeight={500}>{t('Direct peers')}</Text>
        <Text color="muted">{description}</Text>
      </Box>
      {!isDisabled && (
        <Stack spacing={2} pl={2}>
          <Box>
            <Text color="muted">{t("Your node's code")}</Text>
            {code ? (
              <Stack isInline spacing={2} align="center">
                <Text fontFamily="mono" fontSize="sm" wordBreak="break-all">
                  {code}
                </Text>
                <SecondaryButton onClick={onCopy}>
                  {hasCopied ? t('Copied') : t('Copy')}
                </SecondaryButton>
                <SecondaryButton onClick={() => setIsNaming(true)}>
                  {settings.ownPeerName ? t('Rename') : t('Add a name')}
                </SecondaryButton>
              </Stack>
            ) : (
              <Text fontSize="sm">{t('Shown while the node runs.')}</Text>
            )}
          </Box>
          {peers.map((peer) => {
            const state = directPeerState(peer.id, {peerIds, running})
            return (
              <Stack key={peer.id} isInline spacing={3} align="center">
                <Text color={state === 'connected' ? 'blue.500' : 'muted'}>
                  {state === 'connected' ? '●' : '○'}
                </Text>
                <Box flex={1}>
                  <Text>{peer.name || t('Unnamed node')}</Text>
                  <Text color="muted" fontSize="sm">
                    {`${shortPeerId(peer.id)} · ${t(state)}`}
                  </Text>
                </Box>
                <SecondaryButton onClick={() => setRemoving(peer)}>
                  {t('Remove')}
                </SecondaryButton>
              </Stack>
            )
          })}
          {peers.length < MAX_DIRECT_PEERS && (
            <Box>
              <SecondaryButton onClick={() => setIsAdding(true)}>
                {t('Add a peer')}
              </SecondaryButton>
            </Box>
          )}
        </Stack>
      )}
      {isAdding && (
        <AddPeerDialog
          peers={peers}
          ownId={ownId}
          onClose={() => setIsAdding(false)}
          onAdd={(peer) => {
            setIsAdding(false)
            savePeers([...peers, peer])
          }}
        />
      )}
      {isNaming && (
        <NameDialog
          current={settings.ownPeerName}
          onClose={() => setIsNaming(false)}
          onSave={(name) => {
            setIsNaming(false)
            // The node does not take the name: no restart.
            onSave('', {ownPeerName: cleanPeerName(name)})
          }}
        />
      )}
      <Dialog
        isOpen={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={t('Remove {{name}}?', {
          name: removing?.name || (removing && shortPeerId(removing.id)),
        })}
      >
        <DialogBody>
          <Text>
            {t(
              'The node stops keeping it as a peer from its next start. To add it again, you need its code.'
            )}
          </Text>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={() => setRemoving(null)}>
            {t('Cancel')}
          </SecondaryButton>
          <PrimaryButton
            onClick={() => {
              const gone = removing
              setRemoving(null)
              savePeers(peers.filter((peer) => peer.id !== gone.id))
            }}
          >
            {t('Remove')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    </Stack>
  )
}

/** Takes a peer code (or a bare peer id), pasted or typed, and the name to keep it under. */
function AddPeerDialog({peers, ownId, onClose, onAdd}) {
  const {t} = useTranslation()
  const [code, setCode] = React.useState('')
  const [name, setName] = React.useState('')
  const [nameEdited, setNameEdited] = React.useState(false)
  const parsed = parsePeerCode(code)
  let problem = null
  if (code.trim() && !parsed) {
    problem = t(
      'Not a peer code: it reads idena-peer:Qm… or idena-peer:12D3Koo…',
      {nsSeparator: '!!'}
    )
  } else if (parsed) {
    const found = directPeerProblem(parsed, peers, ownId)
    problem = found && t(found)
  }

  return (
    <Dialog isOpen onClose={onClose} title={t('Add a peer')}>
      <DialogBody>
        <Stack spacing={3}>
          <Box>
            <FormLabel htmlFor="direct-peer-code">{t('Peer code')}</FormLabel>
            <Input
              id="direct-peer-code"
              value={code}
              autoFocus
              isInvalid={Boolean(problem)}
              onChange={(e) => {
                const text = e.target.value
                setCode(text)
                // The code's name fills the field until the user types their own.
                if (!nameEdited) setName(parsePeerCode(text)?.name ?? '')
              }}
            />
            {problem && (
              <Text color="red.500" fontSize="sm" mt={1}>
                {problem}
              </Text>
            )}
          </Box>
          <Box>
            <FormLabel htmlFor="direct-peer-name">{t('Name')}</FormLabel>
            <Input
              id="direct-peer-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameEdited(true)
              }}
            />
          </Box>
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          isDisabled={!parsed || Boolean(problem)}
          onClick={() => onAdd({id: parsed.id, name: cleanPeerName(name)})}
        >
          {t('Add')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** Asks the name the node's own code carries. */
function NameDialog({current, onClose, onSave}) {
  const {t} = useTranslation()
  const [name, setName] = React.useState(current || '')
  return (
    <Dialog isOpen onClose={onClose} title={t('Name in your code')}>
      <DialogBody>
        <Text mb={2}>
          {t('The other person sees it in their list; it may stay empty.', {
            nsSeparator: '!!',
          })}
        </Text>
        <Input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton onClick={() => onSave(name)}>{t('Save')}</PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
