/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {useQuery} from 'react-query'
import {
  Button,
  Checkbox,
  HStack,
  Stack,
  Text,
  Textarea,
  useClipboard,
} from '@chakra-ui/react'
import {
  SmallText,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {shortAddress} from '../people'
import {holderOf, profilesEnabled} from '../profiles'
import {chatCandidates, claimableName} from '../candidates'
import {
  addressOfPublicKey,
  messageCode,
  messageCodeFor,
  parseMessageCode,
} from '../message-code'
import {socialRpcSettled} from '../node'
import {ownPublicKey} from '../own-key'
import {PersonAvatar} from '../components/profile-public'
import {PersonName} from '../components/identity'
import {SearchField} from './common'

/** The holder of the name `query` may be (claimableName), from the profiles contract; null while asked or for none. */
export function useNameHolder(query) {
  const name = claimableName(query)
  const {data} = useQuery(
    ['profile', 'holder', name],
    () => holderOf(socialRpcSettled, name),
    {enabled: profilesEnabled && Boolean(name), staleTime: 60 * 1000}
  )
  return name ? data ?? null : null
}

/**
 * Who `query` can be (chatCandidates): a message code pasted gives its account, its key kept (addMessageCode) once
 * the account's saved messages are loaded, a name typed its holder in the profiles contract.
 */
export function useCandidates(query) {
  const {people, conversations, me, names, addMessageCode, chatsLoaded} =
    useSocial()
  const code = parseMessageCode(query)
  const coded = code ? addressOfPublicKey(code) : null
  React.useEffect(() => {
    if (coded && chatsLoaded) addMessageCode(coded, query)
    // Once per code, and again once the saved messages are loaded (before, it cannot be kept).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coded, chatsLoaded])
  const holder = useNameHolder(code ? '' : query)
  return React.useMemo(
    () =>
      chatCandidates(code ? '' : query, {
        people,
        conversations,
        me,
        known: names,
        found: coded ?? holder,
      }),
    [code, coded, conversations, holder, me, names, people, query]
  )
}

/** A person to write to or to choose: avatar, name, address. */
export function PersonRow({address, onClick, checked = null}) {
  return (
    <HStack
      spacing={3}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={2}
      cursor="pointer"
      onClick={onClick}
    >
      <PersonAvatar address={address} boxSize={8} rounded="md" />
      <Stack spacing={0} flex={1} minW={0}>
        <Text fontWeight={500} noOfLines={1}>
          <PersonName address={address} />
        </Text>
        <SmallText fontFamily="mono">{shortAddress(address)}</SmallText>
      </Stack>
      {checked !== null && (
        <Checkbox isChecked={checked} pointerEvents="none" />
      )}
    </HStack>
  )
}

/**
 * The Messages search (B-144): the people of the conversations and the People list, the accounts known by name, a
 * whole address, a name claimed in the profiles contract (with or without "@") or a message code; a click opens the
 * conversation with that account, followed or not. Nothing below it while it is empty.
 */
export function NewChatSearch({openChat}) {
  const {t} = useTranslation()
  const {chatKey} = useSocial()
  const [query, setQuery] = React.useState('')
  const candidates = useCandidates(query)
  return (
    <Stack spacing={2}>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t('Write to a name, @name, address or message code')}
      />
      {query.trim() !== '' && candidates.length === 0 && (
        <SmallText>{t('Nobody found.')}</SmallText>
      )}
      {query.trim() !== '' &&
        candidates
          .slice(0, 20)
          .map((address) => (
            <PersonRow
              key={address}
              address={address}
              onClick={() => openChat(chatKey([address]))}
            />
          ))}
    </Stack>
  )
}

/**
 * The account's message code: its public key, for the people who should be able to write to it before its first
 * transaction. The key comes from the node's signature (own-key.js: any node, no transaction needed), else from the
 * chain (its identity's, or one it signed in a call the scan read).
 */
export function MyMessageCode({isOpen, onClose}) {
  const {t} = useTranslation()
  const {me, messageKeys, lookUpKeys} = useSocial()
  // undefined while the node is asked, null when it gave none.
  const [signedKey, setSignedKey] = React.useState()
  React.useEffect(() => {
    if (!isOpen || !me) return undefined
    let live = true
    setSignedKey(undefined)
    ownPublicKey(me).then(
      (found) => live && setSignedKey(found),
      () => live && setSignedKey(null)
    )
    lookUpKeys([me])
    return () => {
      live = false
    }
  }, [isOpen, lookUpKeys, me])
  const chainKey = me ? messageKeys[me] : undefined
  const key =
    signedKey || (signedKey === null ? chainKey : chainKey || undefined)
  // Only a whole key (65 bytes) makes a code the other apps read.
  const whole = key ? parseMessageCode(key) : null
  const code = whole ? messageCode(whole) : ''
  const {hasCopied, onCopy} = useClipboard(code)
  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <DialogHeader>{t('Your message code')}</DialogHeader>
      <DialogBody>
        <Stack spacing={3}>
          <Text>
            {t(
              'Share it with the people who should be able to write to you: with it they can, even before your first transaction. It holds only your public key, nothing secret.',
              {nsSeparator: '|'}
            )}
          </Text>
          {key === undefined && (
            <SmallText>{t('Looking up your key…')}</SmallText>
          )}
          {(key === '' || (key && !whole)) && (
            <Text color="red.500">
              {t(
                'The node did not give your public key. Check that it is running, then open this again.'
              )}
            </Text>
          )}
          {code && (
            <Text fontFamily="mono" fontSize="sm" wordBreak="break-all">
              {code}
            </Text>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
        <PrimaryButton isDisabled={!code} onClick={onCopy}>
          {hasCopied ? t('Copied') : t('Copy')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** Adds `address`'s message code, pasted: kept once it is that account's (messageCodeFor). */
export function AddMessageCode({address, isOpen, onClose}) {
  const {t} = useTranslation()
  const {addMessageCode} = useSocial()
  const [text, setText] = React.useState('')
  const typed = text.trim() !== ''
  const notCode = typed && !parseMessageCode(text)
  const wrong = typed && !notCode && !messageCodeFor(text, address)
  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <DialogHeader>{t('Add their message code')}</DialogHeader>
      <DialogBody>
        <Stack spacing={3}>
          <Text>
            {t(
              'Ask them for their message code (Messages, "My message code") and paste it here. You can also paste it in the Messages search.'
            )}
          </Text>
          <Textarea
            value={text}
            rows={3}
            fontFamily="mono"
            placeholder={t('Message code')}
            onChange={(e) => setText(e.target.value)}
          />
          {notCode && (
            <Text color="red.500">
              {t(
                'This is not a message code: it starts with idena-key: and holds 130 characters.',
                {nsSeparator: '|'}
              )}
            </Text>
          )}
          {wrong && (
            <Text color="red.500">{t("This code is another account's.")}</Text>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          isDisabled={!typed || notCode || wrong}
          onClick={() => {
            if (addMessageCode(address, text)) onClose()
          }}
        >
          {t('Add')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** A link-styled button, as the Requests line. */
export const LinkButton = (props) => (
  <Button variant="link" alignSelf="flex-start" {...props} />
)
