/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, HStack, IconButton, Stack, Text} from '@chakra-ui/react'
import {useSocial} from '../provider'
import {person, shortAddress} from '../people'
import {identityColor} from '../format'
import {Chip, FollowChip} from '../components/chips'
import {CopyButton} from './common'
import {useMembers, useTrust, useTrustsGiven} from '../profile-hooks'
import {inviteeAddresses} from '../profile-lists'
import {profilesEnabled} from '../profiles'
import {ProfilePicture, TrustButton} from '../components/profile-public'
import {OwnProfileMenu, ProfileMenu} from '../components/hide-menu'

// The top of a profile, as the phone app's (B-89, B-91): the picture, beside it the name and the address with ⚙ (one's
// own) or ⋯ (another's); then, in this order, the identity, the people as counts, each opening its list ("🤝 15
// trusted by · 4 trusts given", "👥 3 members · 2 invitees"), the likes, the tips, and on one's own profile the people
// and topics followed. Under it, on another's profile, Message, Trust and Follow.

/** The lists a profile's counts open (ProfileListPage). */
export const ProfileList = {
  TrustedBy: 'trusted-by',
  TrustsGiven: 'trusts-given',
  Members: 'members',
  Invitees: 'invitees',
}

/** A count of the header: "…" while it is read; a click opens its list. */
function Count({text, onClick}) {
  return (
    <Text as="button" fontWeight={500} onClick={onClick}>
      {text}
    </Text>
  )
}

/** The header's two lines of people: Trust received and given, the members vouched for and the invitees. */
function PeopleCounts({address, identity, identityLoading, openList}) {
  const {t} = useTranslation()
  const trust = useTrust(address)
  const given = useTrustsGiven(address)
  const members = useMembers(address)
  const invitees = inviteeAddresses(identity).length
  const count = (query, of) => (query.isLoading || !query.data ? '…' : of())
  const trustedBy = count(trust, () => trust.data.counted.length)
  const trustsGiven = count(given, () => given.data.length)
  const memberCount = count(members, () => members.data.length)
  const inviteeCount = identityLoading ? '…' : invitees
  return (
    <Stack spacing={0.5} fontSize="md">
      {profilesEnabled && (
        <HStack spacing={1.5} flexWrap="wrap">
          <Text>🤝</Text>
          <Count
            text={t('{{count}} trusted by', {count: trustedBy})}
            onClick={() => openList(ProfileList.TrustedBy)}
          />
          <Text color="muted">·</Text>
          <Count
            text={t('{{count}} trusts given', {count: trustsGiven})}
            onClick={() => openList(ProfileList.TrustsGiven)}
          />
        </HStack>
      )}
      <HStack spacing={1.5} flexWrap="wrap">
        <Text>👥</Text>
        {profilesEnabled && (
          <>
            <Count
              text={
                memberCount === 1
                  ? t('1 member')
                  : t('{{count}} members', {count: memberCount})
              }
              onClick={() => openList(ProfileList.Members)}
            />
            <Text color="muted">·</Text>
          </>
        )}
        <Count
          text={
            inviteeCount === 1
              ? t('1 invitee')
              : t('{{count}} invitees', {count: inviteeCount})
          }
          onClick={() => openList(ProfileList.Invitees)}
        />
      </HStack>
    </Stack>
  )
}

/**
 * The header of the profile of `address`: `name` (shown name, or null), `statusLine` (its identity), `identity` (the
 * node's dna_identity answer), `activity` (its likes and tips received and given); `onEdit` opens one's own profile
 * editor, `openSettings(tab)` Social settings (at the people or the topics followed).
 */
export function ProfileHeader({
  address,
  name,
  statusLine,
  identity,
  identityLoading,
  publicProfile,
  isMe,
  isBlocked,
  activity,
  openList,
  onRename,
  openChat,
  openSettings,
  onEdit,
}) {
  const {t} = useTranslation()
  const {people, setPerson, chatKey, followedTopics} = useSocial()
  const following = Object.values(people).filter((one) => one.following)
  return (
    <Stack spacing={3}>
      <HStack spacing={4} align="center">
        <ProfilePicture
          address={address}
          profile={publicProfile}
          boxSize={24}
        />
        <Stack spacing={1} flex={1} minW={0}>
          <Text fontSize="lg" fontWeight={500} noOfLines={1}>
            {name || shortAddress(address)}
            {isMe && ` ${t('(you)')}`}
          </Text>
          {/* The address beside the picture, then ⚙ or ⋯ (user 2026-10-17, B-92). */}
          <HStack spacing={1}>
            <Text
              fontFamily="mono"
              fontSize="sm"
              color="muted"
              flex={1}
              minW={0}
              wordBreak="break-all"
            >
              {address}
            </Text>
            <CopyButton value={address} />
            {isMe && (
              <OwnProfileMenu
                onEdit={onEdit}
                onRename={() => onRename(address)}
                openSettings={() => openSettings()}
              />
            )}
            {!isMe && !isBlocked && (
              <ProfileMenu address={address} onRename={onRename} />
            )}
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
          </HStack>
        </Stack>
      </HStack>
      <Stack spacing={1} fontSize="md">
        <Text
          fontWeight={500}
          color={identityColor(identity?.state) || 'muted'}
        >
          {statusLine}
        </Text>
        {isBlocked && (
          <Text color="red.500">
            {t(
              'Blocked: their posts, replies, comments and messages are hidden on this computer.',
              {nsSeparator: '|'}
            )}
          </Text>
        )}
        <PeopleCounts
          address={address}
          identity={identity}
          identityLoading={identityLoading}
          openList={openList}
        />
        <Text>
          {`♡ ${t('{{received}} received · {{given}} given', {
            received: activity.likesReceived,
            given: activity.likesGiven,
          })}`}
        </Text>
        <Text>
          {`🪙 ${t('{{received}} received · {{given}} given iDNA', {
            received: activity.tipsReceived,
            given: activity.tipsGiven,
          })}`}
        </Text>
        {isMe && (
          <HStack spacing={1.5}>
            <Text>⭐</Text>
            <Count
              text={t('{{count}} following', {count: following.length})}
              onClick={() => openSettings('people')}
            />
            <Text color="muted">·</Text>
            <Count
              text={
                followedTopics.length === 1
                  ? t('1 topic')
                  : t('{{count}} topics', {count: followedTopics.length})
              }
              onClick={() => openSettings('topics')}
            />
          </HStack>
        )}
      </Stack>
      {!isMe && !isBlocked && (
        <HStack spacing={2}>
          {openChat && (
            <IconButton
              variant="outline"
              size="sm"
              h={8}
              aria-label={t('Message')}
              title={t('Message')}
              icon={<Text fontSize="lg">✉</Text>}
              onClick={() => openChat(chatKey([address]))}
            />
          )}
          <TrustButton target={address} />
          <FollowChip address={address} />
          <Box flex={1} />
        </HStack>
      )}
    </Stack>
  )
}
