/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, HStack, Stack, Text, IconButton} from '@chakra-ui/react'
import {Avatar, SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {useSocialIdentity} from '../hooks'
import {shortAddress} from '../people'
import {socialProfile} from '../activity'
import {ProfileItemCard} from '../components/activity'
import {Chip, FollowChip} from '../components/chips'
import {PostRow} from '../components/post'
import {identityColor, identityStatus} from '../format'
import {historyDone} from '../scan'
import {CopyButton, PAGE_SIZE, Rows, ShowMore} from './common'

export function ProfileView({address, now, openThread, openProfile, onRename}) {
  const {t} = useTranslation()
  const {feed, me, people, cache} = useSocial()
  const {data: identity, isError} = useSocialIdentity(address)
  const profile = React.useMemo(
    () => socialProfile(feed, address),
    [address, feed]
  )
  const [tab, setTab] = React.useState('posts')
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => setShown(PAGE_SIZE), [tab, address])
  const name = people[address]?.name
  const isMe = address === me
  const status = identityStatus(identity?.state)
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
      <HStack spacing={3} align="center">
        <Avatar address={address} boxSize={16} rounded="lg" />
        <Stack spacing={0.5} flex={1} minW={0}>
          <HStack spacing={1}>
            <Text fontSize="lg" fontWeight={500} noOfLines={1}>
              {name || shortAddress(address)}
              {isMe && ` ${t('(you)')}`}
            </Text>
            {!name && <CopyButton value={address} />}
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={name ? t('Rename') : t('Name')}
              title={name ? t('Rename') : t('Name')}
              icon={<Text>✎</Text>}
              onClick={() => onRename(address)}
            />
            <Box flex={1} />
            {!isMe && <FollowChip address={address} />}
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
        </Stack>
      </HStack>
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
