/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, HStack, Stack, Text, IconButton} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {useSocialIdentity} from '../hooks'
import {person, shortAddress} from '../people'
import {socialProfile} from '../activity'
import {ProfileItemCard} from '../components/activity'
import {Chip, FollowChip} from '../components/chips'
import {PostRow} from '../components/post'
import {identityColor, identityStatus} from '../format'
import {historyDone} from '../scan'
import {CopyButton, PAGE_SIZE, Rows, ShowMore} from './common'
import {useMembers, useProfile} from '../profile-hooks'
import {isActingMember} from '../vouching'
import {inviteeAddresses, inviterOf} from '../profile-lists'
import {
  ProfileEditDialog,
  ProfilePicture,
  PublicProfile,
  useShownName,
} from '../components/profile-public'
import {OwnProfileMenu, ProfileMenu} from '../components/hide-menu'
import {LINK} from '../components/theme'
import {ProfilePeople} from './profile-people'

/** "Invited by <name>" under the identity line, while the node keeps the link; a click opens the inviter. */
function InvitedBy({address, onProfile}) {
  const {t} = useTranslation()
  const name = useShownName(address)
  return (
    <Text
      as="button"
      textAlign="left"
      fontSize="md"
      color={LINK}
      onClick={() => onProfile(address)}
    >
      {t('Invited by {{name}}', {name: name || shortAddress(address)})}
    </Text>
  )
}

export function ProfileView({
  address,
  now,
  openThread,
  openProfile,
  onRename,
  openChat,
  openSettings,
}) {
  const {t} = useTranslation()
  // The feed as shown: a blocked account's profile lists nothing.
  const {shownFeed: feed, me, people, setPerson, cache, chatKey} = useSocial()
  const {
    data: identity,
    isError,
    isLoading: identityLoading,
    error: identityError,
  } = useSocialIdentity(address)
  const members = useMembers(address)
  const [editing, setEditing] = React.useState(false)
  // The invitees the node keeps (until each is Verified or Human, or killed) and the members vouched for.
  const invitees = React.useMemo(() => inviteeAddresses(identity), [identity])
  const memberAddresses = React.useMemo(
    () => (members.data || []).map(({member}) => member),
    [members.data]
  )
  const inviter = inviterOf(identity)
  const profile = React.useMemo(
    () => socialProfile(feed, address),
    [address, feed]
  )
  const [tab, setTab] = React.useState('posts')
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => setShown(PAGE_SIZE), [tab, address])
  const {data: publicProfile} = useProfile(address)
  // A private name wins; then the claimed one, while its holder is in good standing.
  const name =
    people[address]?.name ||
    (publicProfile?.inStanding && publicProfile.name
      ? `@${publicProfile.name}`
      : null)
  const isMe = address === me
  const isBlocked = !isMe && people[address]?.blocked === true
  // An account without an identity acts through its voucher while that one is validated.
  const status = isActingMember(publicProfile)
    ? 'Vouched member'
    : identityStatus(identity?.state)
  const tabs = [
    ['posts', t('Posts')],
    ['replies', t('Replies')],
    ['comments', t('Comments')],
    ['likes', t('Likes')],
    ['tips', t('Tips')],
    ['media', t('Media')],
    ['invitees', t('Invitees')],
    ['members', t('Members')],
  ]
  const counts = {
    invitees: identityLoading ? '…' : invitees.length,
    members: members.isLoading ? '…' : memberAddresses.length,
  }
  const isPeople = tab === 'invitees' || tab === 'members'
  const items = isPeople ? [] : profile[tab]

  let statusLine = t('Identity: asking the node…', {nsSeparator: '|'})
  if (isError)
    statusLine = t('Identity: the node did not answer.', {nsSeparator: '|'})
  else if (identity)
    statusLine = [
      t(status),
      identity.age > 0 &&
        status !== 'Not validated' &&
        t('age {{age}}', {age: identity.age}),
      Number(identity.stake) > 0 &&
        t('stake {{stake}} iDNA', {
          stake: Math.floor(Number(identity.stake)).toLocaleString(),
        }),
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <Stack spacing={3} w="full">
      <HStack spacing={3} align="center">
        <ProfilePicture
          address={address}
          profile={publicProfile}
          boxSize={16}
        />
        <Stack spacing={0.5} flex={1} minW={0}>
          <HStack spacing={1}>
            <Text fontSize="lg" fontWeight={500} noOfLines={1}>
              {name || shortAddress(address)}
              {isMe && ` ${t('(you)')}`}
            </Text>
            {!name && <CopyButton value={address} />}
            <Box flex={1} />
            {isBlocked && (
              <Chip
                onClick={() =>
                  setPerson({
                    ...(people[address] || person(address)),
                    blocked: false,
                  })
                }
              >
                {t('Unblock')}
              </Chip>
            )}
            {!isMe && !isBlocked && openChat && (
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('Message')}
                title={t('Message')}
                icon={<Text>✉</Text>}
                onClick={() => openChat(chatKey([address]))}
              />
            )}
            {!isMe && !isBlocked && <FollowChip address={address} />}
            {!isMe && !isBlocked && (
              <ProfileMenu address={address} onRename={onRename} />
            )}
            {isMe && (
              <OwnProfileMenu
                onEdit={() => setEditing(true)}
                onRename={() => onRename(address)}
                openSettings={openSettings}
              />
            )}
          </HStack>
          {name && (
            <HStack spacing={1}>
              <Text fontFamily="mono" fontSize="sm" color="muted">
                {shortAddress(address)}
              </Text>
              <CopyButton value={address} />
            </HStack>
          )}
          <Text
            fontSize="md"
            fontWeight={500}
            color={identityColor(identity?.state) || 'muted'}
          >
            {statusLine}
          </Text>
          {inviter && <InvitedBy address={inviter} onProfile={openProfile} />}
          {isBlocked && (
            <Text fontSize="md" color="red.500">
              {t(
                'Blocked: their posts, replies, comments and messages are hidden on this computer.',
                {nsSeparator: '|'}
              )}
            </Text>
          )}
        </Stack>
      </HStack>
      <PublicProfile
        address={address}
        isMe={isMe}
        profile={publicProfile}
        privateName={Boolean(people[address]?.name)}
        onProfile={openProfile}
      />
      {editing && (
        <ProfileEditDialog
          profile={publicProfile}
          onClose={() => setEditing(false)}
        />
      )}
      <Stack spacing={0.5} fontSize="md">
        <Text>
          {`❤️ ${t('{{received}} received · {{given}} given', {
            received: profile.likesReceived,
            given: profile.likes.length,
          })}`}
        </Text>
        <Text>
          {`🪙 ${t('{{received}} received · {{given}} given iDNA', {
            received: profile.tipsReceived,
            given: profile.tipsGiven,
          })}`}
        </Text>
      </Stack>
      {cache && !historyDone(cache) && (
        <SmallText>
          {t(
            'From the blocks read so far. Older posts appear as the history scan goes on.'
          )}
        </SmallText>
      )}
      <HStack spacing={2} flexWrap="wrap">
        {tabs.map(([value, label]) => (
          <Chip
            key={value}
            isSelected={tab === value}
            onClick={() => setTab(value)}
          >
            {`${label} ${counts[value] ?? profile[value].length}`}
          </Chip>
        ))}
      </HStack>
      {tab === 'invitees' && (
        <ProfilePeople
          addresses={invitees}
          isLoading={identityLoading}
          error={identityError}
          empty={t(
            'No invitee on the way: an invitee shows here from its invitation until it is Verified.',
            {nsSeparator: '|'}
          )}
          onOpen={openProfile}
        />
      )}
      {tab === 'members' && (
        <ProfilePeople
          addresses={memberAddresses}
          isLoading={members.isLoading}
          error={members.error}
          empty={t('No vouched member.')}
          onOpen={openProfile}
        />
      )}
      {!isPeople && items.length === 0 && (
        <SmallText>{t('Nothing here yet.')}</SmallText>
      )}
      {!isPeople &&
        (tab === 'posts' ? (
          <Rows>
            {items.slice(0, shown).map((item) => (
              <PostRow
                key={item.node.id}
                node={item.node}
                now={now}
                onOpen={() => openThread(item.threadId, item.node.id)}
                onProfile={openProfile}
              />
            ))}
          </Rows>
        ) : (
          <Stack spacing={2}>
            {items.slice(0, shown).map((item) => (
              <ProfileItemCard
                key={`${item.node.id}-${
                  item.like?.hash || item.tip?.hash || ''
                }`}
                item={item}
                tab={tab}
                now={now}
                onOpen={() => openThread(item.threadId, item.node.id)}
                onProfile={openProfile}
              />
            ))}
          </Stack>
        ))}
      <ShowMore
        shown={shown}
        total={items.length}
        onMore={() => setShown(shown + PAGE_SIZE)}
      />
    </Stack>
  )
}
