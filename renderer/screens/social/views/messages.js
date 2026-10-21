/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Button,
  Flex,
  HStack,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {ipfsCid} from '../calls'
import {timeAgo} from '../format'
import {useIpfsContent} from '../hooks'
import {decryptIpfsText, unreadCount} from '../messages'
import {KEY_LINE, REMOVED_LINE, isGroupKey, previousKeyLines} from '../groups'
import {messagesPending} from '../scan'
import {MUTED} from '../components/theme'
import {PersonAvatar} from '../components/profile-public'
import {
  AddMessageCode,
  LinkButton,
  MyMessageCode,
  NewChatSearch,
} from './new-chat'
import {GroupAvatar, GroupEventLine, GroupMembers, groupTitle} from './groups'

/** The most characters of a message written here (the fee grows with the text). */
const MAX_MESSAGE = 2000

/** The people of a conversation as a title: their names, or short addresses. */
const othersTitle = (others, names) =>
  others.map((address) => displayName(address, names)).join(', ')

/** A conversation's title: a group's (groupTitle), else its people's names. */
const titleOf = (conversation, me, names) =>
  conversation.group
    ? groupTitle(conversation.group, me, names)
    : othersTitle(conversation.others, names)

/** One line of a message for the list: its text, or what it is. */
function preview(message, t) {
  if (message.text.startsWith('ipfs://')) return t('Text on IPFS')
  if (message.text) return message.text.replace(/\s+/g, ' ')
  if (message.hasMedia) return t('🖼 Picture')
  return '…'
}

/** A conversation's last line for the list: a group's removal or change, else its last message. */
function lastLine(conversation, t) {
  if (conversation.removedMe) return t('You were removed from the group')
  if (conversation.last.kind === KEY_LINE) return t('Group change')
  return preview(conversation.last, t)
}

/** Why no message can be sent to `addresses`: no public key is known for them. */
function NoKeyText({addresses, names}) {
  const {t} = useTranslation()
  const [adding, setAdding] = React.useState(false)
  return (
    <Stack spacing={1}>
      <Text fontSize="sm" color="red.500">
        {t(
          '{{names}} cannot receive private messages: no public key is known for them (never an Idena identity, and no transaction they signed on Idena Social), so nothing can be encrypted for them.',
          {names: othersTitle(addresses, names), nsSeparator: '|'}
        )}
      </Text>
      {addresses.length === 1 && (
        <>
          <LinkButton onClick={() => setAdding(true)}>
            {t('Add their message code')}
          </LinkButton>
          <AddMessageCode
            address={addresses[0]}
            isOpen={adding}
            onClose={() => setAdding(false)}
          />
        </>
      )}
    </Stack>
  )
}

/**
 * The Inbox's Messages, as the phone app's: the conversations, the latest first, with what was not read; Requests
 * (strangers) behind their own line. A click opens the conversation.
 */
export function MessagesList({now, openChat, newGroup}) {
  const {t} = useTranslation()
  const {conversations, chatStore, names, me, cache} = useSocial()
  const [requests, setRequests] = React.useState(false)
  const [showCode, setShowCode] = React.useState(false)
  const waiting = conversations.filter(({isRequest}) => isRequest).length
  const shown = conversations.filter(({isRequest}) => isRequest === requests)
  let empty = t('No conversation yet.')
  if (requests) empty = t('No request.')
  else if (cache && messagesPending(cache))
    empty = t(
      'No conversation yet. The messages of the blocks read before are still being read.'
    )
  return (
    <Stack spacing={3} w="full">
      {requests && (
        <Button
          variant="link"
          alignSelf="flex-start"
          onClick={() => setRequests(false)}
        >
          ‹ {t('Conversations')}
        </Button>
      )}
      {!requests && waiting > 0 && (
        <Button
          variant="link"
          alignSelf="flex-start"
          onClick={() => setRequests(true)}
        >
          {t('Requests ({{count}})', {count: waiting})} ›
        </Button>
      )}
      {!requests && (
        <>
          <NewChatSearch openChat={openChat} />
          <HStack spacing={4}>
            <LinkButton onClick={newGroup}>{t('New group')}</LinkButton>
            <LinkButton onClick={() => setShowCode(true)}>
              {t('My message code')}
            </LinkButton>
          </HStack>
          <MyMessageCode isOpen={showCode} onClose={() => setShowCode(false)} />
        </>
      )}
      {requests && (
        <SmallText>
          {t(
            'Messages from people you do not follow and never wrote to. Answer or accept to move them to your conversations.'
          )}
        </SmallText>
      )}
      {shown.length === 0 && <SmallText>{empty}</SmallText>}
      {shown.map((conversation) => {
        const unread = unreadCount(
          conversation,
          me,
          chatStore.seen[conversation.key],
          chatStore.readBefore
        )
        return (
          <HStack
            key={conversation.key}
            spacing={3}
            borderWidth={1}
            borderColor="gray.100"
            rounded="lg"
            p={3}
            cursor="pointer"
            onClick={() => openChat(conversation.key)}
          >
            <Box position="relative">
              {conversation.group ? (
                <GroupAvatar boxSize={10} />
              ) : (
                <PersonAvatar
                  address={conversation.others[0]}
                  boxSize={10}
                  rounded="md"
                />
              )}
              {conversation.isGroup && !conversation.group && (
                <Text
                  position="absolute"
                  bottom={-1}
                  right={-1}
                  fontSize="xs"
                  bg="gray.100"
                  rounded="full"
                  px={1}
                >
                  +{conversation.others.length - 1}
                </Text>
              )}
            </Box>
            <Stack spacing={0} flex={1} minW={0}>
              <Text fontWeight={unread > 0 ? 700 : 500} noOfLines={1}>
                {titleOf(conversation, me, names)}
              </Text>
              <Text fontSize="sm" color={MUTED} noOfLines={1}>
                {lastLine(conversation, t)}
              </Text>
            </Stack>
            <Stack spacing={0.5} align="flex-end">
              <SmallText>{timeAgo(conversation.last.time, now)}</SmallText>
              {unread > 0 && (
                <Text
                  fontSize="xs"
                  color="white"
                  bg="blue.500"
                  rounded="full"
                  px={1.5}
                >
                  {unread}
                </Text>
              )}
            </Stack>
          </HStack>
        )
      })}
    </Stack>
  )
}

/** A message's text, from IPFS (encrypted with its textPassword) when the website stored it there. */
function MessageText({text, textPassword}) {
  const {t} = useTranslation()
  const cid = ipfsCid(text)
  const {data, isLoading} = useIpfsContent(cid)
  const [opened, setOpened] = React.useState(undefined)
  React.useEffect(() => {
    let alive = true
    if (!cid || !data) return undefined
    decryptIpfsText(data, textPassword).then(
      (plain) => alive && setOpened(plain)
    )
    return () => {
      alive = false
    }
  }, [cid, data, textPassword])
  if (!cid)
    return (
      <Text whiteSpace="pre-wrap" wordBreak="break-word">
        {text}
      </Text>
    )
  if (isLoading || (data && opened === undefined))
    return (
      <SmallText>{t('Loading the text from IPFS through the node…')}</SmallText>
    )
  if (!data)
    return (
      <SmallText>
        {t('No longer available on IPFS: no node has it.', {
          nsSeparator: '|',
        })}
      </SmallText>
    )
  if (opened === null)
    return <SmallText>{t('The text on IPFS does not open.')}</SmallText>
  return (
    <Text whiteSpace="pre-wrap" wordBreak="break-word">
      {opened}
    </Text>
  )
}

function Bubble({message, mine, showSender, names, now}) {
  const {t} = useTranslation()
  return (
    <Flex justify={mine ? 'flex-end' : 'flex-start'}>
      <Stack
        spacing={0.5}
        maxW="80%"
        bg={mine ? 'blue.012' : 'gray.50'}
        rounded="xl"
        px={3}
        py={2}
      >
        {showSender && !mine && (
          <Text fontSize="sm" fontWeight={500} color="blue.500">
            {displayName(message.from, names)}
          </Text>
        )}
        {message.isReply && (
          <SmallText>{t('↩ An answer to another message')}</SmallText>
        )}
        {message.text && (
          <MessageText
            text={message.text}
            textPassword={message.textPassword}
          />
        )}
        {message.hasMedia && (
          <SmallText>{t('🖼 A picture, not shown here yet')}</SmallText>
        )}
        <SmallText alignSelf="flex-end">{timeAgo(message.time, now)}</SmallText>
      </Stack>
    </Flex>
  )
}

/**
 * The conversation of `chatKey`, as the phone app's: its messages, oldest first, the account's on the right; Accept
 * for a request; and the box to answer, sent to every other participant after the fee is shown.
 */
export function ChatView({chatKey, now, openProfile, editGroup}) {
  const {t} = useTranslation()
  const {
    me,
    names,
    conversations,
    markChatSeen,
    messageKeys,
    lookUpKeys,
    sendMessage,
    sendGroupMessage,
    acceptChat,
    sending,
  } = useSocial()
  const conversation = conversations.find(({key}) => key === chatKey)
  const group = conversation?.group ?? null
  const isGroupChat = isGroupKey(chatKey)
  let others =
    conversation?.others ??
    (isGroupChat ? [] : chatKey.split('-').filter((a) => a !== me))
  if (others.length === 0) others = [me]
  const messages = conversation?.messages ?? []
  const [draft, setDraft] = React.useState('')
  // A group message first reads the newest blocks: meanwhile, and when that fails, what it says.
  const [groupSend, setGroupSend] = React.useState(null)
  const endRef = React.useRef()

  // The text stays until the message is sent (the fee's dialog can be cancelled).
  const sentRef = React.useRef(sending.messagesSent)
  React.useEffect(() => {
    if (sending.messagesSent !== sentRef.current) setDraft('')
    sentRef.current = sending.messagesSent
  }, [sending.messagesSent])

  const othersKey = isGroupChat ? '' : others.join('-')
  React.useEffect(() => {
    if (othersKey) lookUpKeys(othersKey.split('-'))
    // Once per conversation; a key found missing is asked again after a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey, messageKeys])

  const lastHash = conversation?.last?.hash
  React.useEffect(() => {
    endRef.current?.scrollIntoView({block: 'end'})
    if (conversation) markChatSeen(conversation)
    // On a new last message only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastHash])

  const noKey = isGroupChat
    ? []
    : others.filter((address) => messageKeys[address] === '')
  const looking =
    !isGroupChat && others.some((address) => messageKeys[address] === undefined)
  const previous = React.useMemo(
    () => previousKeyLines(conversation?.messages ?? []),
    [conversation]
  )

  if (isGroupChat && !group)
    return (
      <SmallText>{t('This group is not in the blocks read so far.')}</SmallText>
    )
  const title = group
    ? groupTitle(group, me, names)
    : othersTitle(others, names)

  return (
    <Stack spacing={3} w="full">
      <HStack spacing={3}>
        {group ? (
          <GroupAvatar boxSize={10} />
        ) : (
          <PersonAvatar
            address={others[0]}
            boxSize={10}
            rounded="md"
            cursor="pointer"
            onClick={() => openProfile(others[0])}
          />
        )}
        <Stack spacing={0} flex={1} minW={0}>
          <Text fontSize="lg" fontWeight={500} noOfLines={2}>
            {title}
          </Text>
          {group && !conversation.removedMe && <GroupMembers group={group} />}
        </Stack>
        {group && group.admin === me && (
          <SecondaryButton onClick={() => editGroup(chatKey)}>
            {t('Change the group')}
          </SecondaryButton>
        )}
      </HStack>
      <SmallText>
        {group
          ? t(
              "Only the group's members can read its messages. Who writes and when is public, on the chain for good. The group's name and members are not; how many they are shows each time its creator hands out a key."
            )
          : t(
              'Only the people in the conversation can read the text. Who writes, when, how long the message is and how many people it goes to are public, on the chain for good; who gets it is not.'
            )}
      </SmallText>
      {conversation?.isRequest && (
        <HStack spacing={3}>
          <Text flex={1}>{t('Not in your conversations yet.')}</Text>
          <SecondaryButton onClick={() => acceptChat(conversation)}>
            {t('Accept')}
          </SecondaryButton>
        </HStack>
      )}
      {messages.length === 0 && <SmallText>{t('No message yet.')}</SmallText>}
      <Stack spacing={2}>
        {messages.map((message) =>
          message.kind === KEY_LINE || message.kind === REMOVED_LINE ? (
            <GroupEventLine
              key={message.hash}
              line={message}
              previous={previous[message.hash]}
            />
          ) : (
            <Bubble
              key={message.hash}
              message={message}
              mine={message.from === me}
              showSender={others.length > 1 || Boolean(group)}
              names={names}
              now={now}
            />
          )
        )}
        <Box ref={endRef} />
      </Stack>
      {noKey.length > 0 && <NoKeyText addresses={noKey} names={names} />}
      {noKey.length === 0 && looking && (
        <SmallText>{t('Looking up the keys to encrypt for…')}</SmallText>
      )}
      {conversation?.removedMe && (
        <Text fontSize="sm" color="red.500">
          {t(
            'You were removed from this group: you no longer get its key, and what you would send here no longer counts.',
            {nsSeparator: '|'}
          )}
        </Text>
      )}
      {groupSend === 'reading' && (
        <SmallText>{t('Reading the latest blocks first…')}</SmallText>
      )}
      {groupSend === 'behind' && (
        <Text fontSize="sm" color="red.500">
          {t(
            'Not sent: the latest blocks could not be read in time, so the group may have a newer key. Try again.',
            {nsSeparator: '|'}
          )}
        </Text>
      )}
      <HStack
        spacing={2}
        align="flex-end"
        display={conversation?.removedMe ? 'none' : 'flex'}
      >
        <Textarea
          value={draft}
          rows={2}
          maxLength={MAX_MESSAGE}
          placeholder={t('Message')}
          onChange={(e) => setDraft(e.target.value)}
        />
        {/* Sending does not accept a request: once the message is in a block, the conversation holds one of the
            account's and leaves Requests; a send that fails leaves it there. */}
        <PrimaryButton
          isDisabled={
            !sending.canAct ||
            draft.trim() === '' ||
            noKey.length > 0 ||
            looking ||
            groupSend === 'reading'
          }
          onClick={() => {
            if (!group) {
              sendMessage(others, draft.trim())
              return
            }
            setGroupSend('reading')
            sendGroupMessage(conversation, draft.trim(), title)
              .then(() => setGroupSend(null))
              .catch((error) =>
                setGroupSend(error?.message === 'behind' ? 'behind' : null)
              )
          }}
        >
          {t('Send')}
        </PrimaryButton>
      </HStack>
    </Stack>
  )
}
