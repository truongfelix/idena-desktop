/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Divider, HStack, Input, Stack, Switch, Text} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {cleanName, person, shortAddress} from '../people'
import {StatusDot, useScanLabel} from './identity'
import {MUTED} from './theme'
import {SOCIAL_FIRST_BLOCK} from '../contract'
import {historyDone, scannedShare} from '../scan'

/** The dialog to name (or rename) an address, as the phone app's. */
export function NameDialog({address, onClose}) {
  const {t} = useTranslation()
  const {people, setPerson} = useSocial()
  const current = people[address] || person(address)
  const [name, setName] = React.useState(current.name)
  const cleaned = cleanName(name)
  const removes = cleaned === '' && current.name !== ''
  return (
    <Dialog
      title={
        current.name
          ? t('Rename {{name}}', {name: current.name})
          : t('Name {{address}}', {address: shortAddress(address)})
      }
      isOpen
      onClose={onClose}
    >
      <DialogBody>
        <Stack spacing={3}>
          <Text color={MUTED}>
            {t(
              'Shown instead of the address in the Social tab. It stays on this computer: nobody else sees it.',
              {nsSeparator: '|'}
            )}
          </Text>
          <Input
            autoFocus
            value={name}
            placeholder={t('Name')}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          isDisabled={cleaned === current.name}
          onClick={() => {
            setPerson({...current, name: cleaned})
            onClose()
          }}
        >
          {removes ? t('Remove the name') : t('Save')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** The status details: the node, the scan, the history, and the scan switch, as the phone app's ⓘ dialog. */
export function SocialInfoDialog({state, onClose}) {
  const {t} = useTranslation()
  const label = useScanLabel(state)
  const {cache, head, node, feed, scanOff, setScanOff} = useSocial()
  const posts = feed.length
  return (
    <Dialog
      title={
        <HStack spacing={2}>
          <StatusDot health={state.health} size={3.5} />
          <Text>
            {label}
            {node?.peers > 0 &&
              ` · ${t('{{count}} peers', {count: node.peers})}`}
          </Text>
        </HStack>
      }
      isOpen
      onClose={onClose}
      size="md"
    >
      <DialogBody>
        <Stack spacing={2} fontSize="md">
          <Text>
            {node
              ? t('Node at block {{block}}, {{count}} peers.', {
                  block: head?.toLocaleString() ?? '…',
                  count: node.peers ?? 0,
                })
              : t('The node does not answer')}
          </Text>
          {cache && (
            <Text>
              {t('Newest block read {{high}}, the node at {{head}}.', {
                high: cache.high.toLocaleString(),
                head: head?.toLocaleString() ?? '…',
              })}
            </Text>
          )}
          {cache && (
            <Text>
              {historyDone(cache)
                ? t(
                    'History complete since block {{first}}, {{count}} posts.',
                    {first: SOCIAL_FIRST_BLOCK.toLocaleString(), count: posts}
                  )
                : t(
                    'History {{percent}}% read, back to block {{low}}, {{count}} posts.',
                    {
                      percent: Math.floor(scannedShare(cache) * 100),
                      low: cache.low.toLocaleString(),
                      count: posts,
                    }
                  )}
            </Text>
          )}
          <Divider />
          <HStack spacing={3}>
            <Switch
              isChecked={!scanOff}
              onChange={() => setScanOff(!scanOff)}
            />
            <Text fontWeight={500}>{t('Scan blocks')}</Text>
          </HStack>
          <SmallText>
            {t(
              'On, the app reads the new blocks, then the older posts once, then each new block (also with this page closed, once the history is read). Off, nothing is read and the posts already read stay.'
            )}
          </SmallText>
          <Divider />
          {[
            ['good', t('Up to date')],
            ['warn', t('Behind or reading older posts')],
            ['bad', t('No node or no peers')],
            ['off', t('Off, or paused during a validation')],
          ].map(([health, text]) => (
            <HStack key={health} spacing={2}>
              <StatusDot health={health} />
              <SmallText>{text}</SmallText>
            </HStack>
          ))}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
      </DialogFooter>
    </Dialog>
  )
}
