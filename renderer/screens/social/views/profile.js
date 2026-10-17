/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {HStack, Stack} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {useSocialIdentity} from '../hooks'
import {socialProfile} from '../activity'
import {ProfileItemCard} from '../components/activity'
import {Chip} from '../components/chips'
import {PostRow} from '../components/post'
import {identityStatus} from '../format'
import {historyDone} from '../scan'
import {PAGE_SIZE, Rows, ShowMore} from './common'
import {useProfile} from '../profile-hooks'
import {isActingMember} from '../vouching'
import {ProfileEditDialog, PublicProfile} from '../components/profile-public'
import {ProfileHeader, ProfileList} from './profile-header'
import {ProfileListPage} from './profile-list-page'
import {useKeptState} from '../kept-state'

/**
 * The profile of `address`, as the phone app's: its header (profile-header.js: the people as counts, the likes and
 * tips), its public
 * profile, then its content in tabs (Posts, Replies, Comments, Likes, Tips, Media). With `list` (ProfileList), the
 * page of that list instead; `openList(list)` opens one.
 */
export function ProfileView({
  address,
  list = null,
  openList,
  now,
  openThread,
  openProfile,
  onRename,
  openChat,
  openSettings,
}) {
  const {t} = useTranslation()
  // The feed as shown: a blocked account's profile lists nothing.
  const {shownFeed: feed, me, people, cache} = useSocial()
  const {
    data: identity,
    isError,
    isLoading: identityLoading,
    error: identityError,
  } = useSocialIdentity(address)
  const isMe = address === me
  const [editing, setEditing] = React.useState(false)
  const profile = React.useMemo(
    () => socialProfile(feed, address),
    [address, feed]
  )
  // Kept per profile while the app runs: the way back finds the list chosen (B-106); a new list starts at its top.
  const [tab, setTab] = useKeptState(`profile.tab:${address}`, 'posts')
  const [shown, setShown] = useKeptState(
    `profile.shown:${address}:${tab}`,
    PAGE_SIZE
  )
  const {data: publicProfile} = useProfile(address)

  if (Object.values(ProfileList).includes(list))
    return (
      <ProfileListPage
        address={address}
        list={list}
        isMe={isMe}
        identity={identity}
        identityLoading={identityLoading}
        identityError={identityError}
        openProfile={openProfile}
      />
    )

  // A private name wins; then the claimed one, while its holder is in good standing.
  const name =
    people[address]?.name ||
    (publicProfile?.inStanding && publicProfile.name
      ? `@${publicProfile.name}`
      : null)
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
  ]
  const items = profile[tab]

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
      <ProfileHeader
        address={address}
        name={name}
        statusLine={statusLine}
        identity={identity}
        identityLoading={identityLoading}
        publicProfile={publicProfile}
        isMe={isMe}
        isBlocked={isBlocked}
        activity={{
          likesReceived: profile.likesReceived,
          likesGiven: profile.likes.length,
          tipsReceived: profile.tipsReceived,
          tipsGiven: profile.tipsGiven,
        }}
        openList={openList}
        onRename={onRename}
        openChat={openChat}
        openSettings={openSettings}
        onEdit={() => setEditing(true)}
      />
      <PublicProfile
        address={address}
        isMe={isMe}
        profile={publicProfile}
        privateName={Boolean(people[address]?.name)}
      />
      {editing && (
        <ProfileEditDialog
          profile={publicProfile}
          onClose={() => setEditing(false)}
        />
      )}
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
            {`${label} ${profile[value].length}`}
          </Chip>
        ))}
      </HStack>
      {items.length === 0 && <SmallText>{t('Nothing here yet.')}</SmallText>}
      {tab === 'posts' ? (
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
              key={`${item.node.id}-${item.like?.hash || item.tip?.hash || ''}`}
              item={item}
              tab={tab}
              now={now}
              onOpen={() => openThread(item.threadId, item.node.id)}
              onProfile={openProfile}
            />
          ))}
        </Stack>
      )}
      <ShowMore
        shown={shown}
        total={items.length}
        onMore={() => setShown(shown + PAGE_SIZE)}
      />
    </Stack>
  )
}
