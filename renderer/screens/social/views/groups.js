/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, Flex, HStack, Input, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {PrimaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {MAX_GROUP_MEMBERS, MAX_GROUP_NAME, groupEvent} from '../groups'
import {editRows} from '../candidates'
import {PersonRow, useCandidates} from './new-chat'
import {SearchField} from './common'

// The screens of a group with a shared key (groups.js), as the phone app's SocialGroupViews.kt: making one or
// changing its name and members (its admin), and its key messages as lines of the conversation.

/** A group's picture: two people on a round background. */
export function GroupAvatar({boxSize = 10}) {
  return (
    <Flex
      boxSize={boxSize}
      rounded="full"
      bg="blue.012"
      align="center"
      justify="center"
      fontSize="lg"
      flexShrink={0}
    >
      👥
    </Flex>
  )
}

/** A group's title: its admin's name for it, else its members' names. */
export const groupTitle = (group, me, names) =>
  group.name ||
  group.members
    .filter((m) => m !== me)
    .map((m) => displayName(m, names))
    .join(', ')

/** A key message, centred between the messages: what changed against the key line before it (`previous`). */
export function GroupEventLine({line, previous}) {
  const {t} = useTranslation()
  const {me, names} = useSocial()
  const who = (address) =>
    address === me ? t('You') : displayName(address, names)
  const list = (addresses) => addresses.map(who).join(', ')
  const texts = groupEvent(line, previous, me).map((change) => {
    switch (change.kind) {
      case 'created':
        return t('You created the group “{{name}}”', {name: line.text})
      case 'addedYou':
        return t('{{who}} added you to the group “{{name}}”', {
          who: who(line.from),
          name: line.text,
        })
      case 'added':
        return t('{{who}} added {{whom}}', {
          who: who(line.from),
          whom: list(change.who),
        })
      case 'removed':
        return t('{{who}} removed {{whom}}', {
          who: who(line.from),
          whom: list(change.who),
        })
      case 'removedYou':
        return t('{{who}} removed you from the group', {who: who(line.from)})
      case 'renamed':
        return t('{{who}} renamed the group “{{name}}”', {
          who: who(line.from),
          name: change.name,
        })
      default:
        return t('{{who}} gave the group a new key', {who: who(line.from)})
    }
  })
  return (
    <Stack spacing={0} align="center" py={1}>
      {texts.map((text) => (
        <SmallText key={text} textAlign="center">
          {text}
        </SmallText>
      ))}
    </Stack>
  )
}

/** A group's members, its admin first and marked. */
export function GroupMembers({group}) {
  const {t} = useTranslation()
  const {me, names} = useSocial()
  return (
    <SmallText>
      {group.members
        .map((m) => {
          const name = m === me ? t('You') : displayName(m, names)
          return m === group.admin
            ? `${name} (${t('created the group')})`
            : name
        })
        .join(', ')}
    </SmallText>
  )
}

/**
 * A new group (`chatKey` null), or the name and members of the group of `chatKey`, for its admin: a name, the people
 * chosen (the People list, those already written with, the accounts known by name, an address, a claimed name or a
 * message code typed), at most MAX_GROUP_MEMBERS; sent once each one's public key is known, with its fee shown
 * first. With nothing changed, it hands out a new key alone. `onSent` once the call went to the node.
 */
export function GroupEditView({chatKey, onSent}) {
  const {t} = useTranslation()
  const {me, conversations, chatsLoaded} = useSocial()
  const group = chatKey
    ? conversations.find(({key}) => key === chatKey)?.group ?? null
    : null
  // The form starts from the group as it stands: never before the saved messages give it.
  if (chatKey && !group)
    return (
      <SmallText>
        {chatsLoaded ? t('No such group.') : t('Reading the group…')}
      </SmallText>
    )
  if (group && group.admin !== me)
    return (
      <SmallText>
        {t('only the person who created the group can change it')}
      </SmallText>
    )
  return <GroupForm key={chatKey ?? 'new'} group={group} onSent={onSent} />
}

/** GroupEditView's form, for `group` (its last key; null for a new group) as it stood when the form opened. */
function GroupForm({group, onSent}) {
  const {t} = useTranslation()
  const {
    me,
    names,
    messageKeys,
    lookUpKeys,
    saveGroup,
    sendGroupNotice,
    sending,
  } = useSocial()
  const before = React.useMemo(
    () => (group ? group.members.filter((m) => m !== me) : []),
    [group, me]
  )
  const [name, setName] = React.useState(group?.name ?? '')
  const [query, setQuery] = React.useState('')
  const [chosen, setChosen] = React.useState(before)
  const found = useCandidates(query)
  const rows = editRows(chosen, found)

  const chosenKey = chosen.join(',')
  React.useEffect(() => {
    if (chosen.length) lookUpKeys(chosen)
    // On a new choice, and when a key found missing is asked again after a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, messageKeys])

  // The group's call went to the node: the notice to the people it removed (its own confirmation, under the key
  // before the change), then back to the conversation.
  const sentRef = React.useRef(sending.messagesSent)
  React.useEffect(() => {
    if (sending.messagesSent === sentRef.current) return
    const removed = before.filter((m) => !chosen.includes(m))
    if (group && removed.length)
      sendGroupNotice(group, removed, name.trim() || group.name)
    onSent()
    // On a new send only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending.messagesSent])

  const noKey = chosen.filter((address) => messageKeys[address] === '')
  const looking = chosen.some((address) => messageKeys[address] === undefined)
  const changed =
    !group ||
    name.trim() !== group.name ||
    chosen.length !== before.length ||
    chosen.some((m) => !before.includes(m))
  const tooMany = chosen.length > MAX_GROUP_MEMBERS
  const ready =
    sending.canAct &&
    name.trim() !== '' &&
    chosen.length > 0 &&
    !tooMany &&
    noKey.length === 0 &&
    !looking
  const toggle = (address) =>
    setChosen((current) =>
      current.includes(address)
        ? current.filter((a) => a !== address)
        : [...current, address]
    )
  let action = t('Renew the key')
  if (!group) action = t('Create the group')
  else if (changed) action = t('Save the changes')

  return (
    <Stack spacing={3} w="full">
      <Text fontSize="lg" fontWeight={500}>
        {group ? t('Change the group') : t('New group')}
      </Text>
      <Input
        value={name}
        maxLength={MAX_GROUP_NAME}
        placeholder={t('Group name')}
        onChange={(e) => setName(e.target.value)}
      />
      <SmallText>
        {group
          ? t(
              'Saving hands a new key to the people kept and added. People removed do not get it: they cannot read what is sent with it, and their own messages stop counting. People added read from now on.',
              {nsSeparator: '|'}
            )
          : t(
              "Each person chosen receives the group's key in one transaction from you. Then every message is a single transaction, whatever the group's size. Members see the group in this app and the phone app only, not on the Idena Social website."
            )}
      </SmallText>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t('Add a name, @name, address or message code')}
      />
      <Text fontSize="sm" fontWeight={500}>
        {t('{{count}} of {{max}} people chosen', {
          count: chosen.length,
          max: MAX_GROUP_MEMBERS,
        })}
      </Text>
      <Stack spacing={2} maxH="360px" overflowY="auto">
        {rows.map((address) => (
          <PersonRow
            key={address}
            address={address}
            checked={chosen.includes(address)}
            onClick={() => toggle(address)}
          />
        ))}
      </Stack>
      {noKey.length > 0 && (
        <Text fontSize="sm" color="red.500">
          {t(
            '{{names}} cannot receive private messages: no public key is known for them (never an Idena identity, and no transaction they signed on Idena Social), so nothing can be encrypted for them.',
            {
              names: noKey.map((a) => displayName(a, names)).join(', '),
              nsSeparator: '|',
            }
          )}
        </Text>
      )}
      {noKey.length === 0 && looking && (
        <SmallText>{t('Looking up the keys to encrypt for…')}</SmallText>
      )}
      {tooMany && (
        <Text fontSize="sm" color="red.500">
          {t('a group holds 1 to {{count}} people besides you', {
            count: MAX_GROUP_MEMBERS,
          })}
        </Text>
      )}
      <HStack justify="flex-end">
        <PrimaryButton
          isDisabled={!ready}
          onClick={() => saveGroup(group, name, chosen)}
        >
          {action}
        </PrimaryButton>
      </HStack>
      <Box />
    </Stack>
  )
}
