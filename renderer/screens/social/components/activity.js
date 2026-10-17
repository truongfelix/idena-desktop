/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {Box, Divider, HStack, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {ActivityKind, NotifyKind} from '../activity'
import {validTipAmount} from '../calls'
import {NameLink} from './identity'
import {FEED_TEXT_LINES, FullHeader, PostBody, PostText} from './post'
import {LINK, MUTED} from './theme'
import {LIKE} from '../contract'
import {likeCount, replyCount, tipTotal} from '../feed'
import {timeAgo, tipText} from '../format'
import {PersonAvatar} from './profile-public'

/** A notification of the Inbox: who did what on which post, and the answer. */
export function ActivityCard({item, now, isNew, onOpen, onProfile}) {
  const {t} = useTranslation()
  const action = {
    [ActivityKind.Like]: t('liked your post'),
    [ActivityKind.Reply]: t('replied to your post'),
    [ActivityKind.Comment]: t('commented on your post'),
    [ActivityKind.Tip]: t('tipped you {{amount}} iDNA for your post', {
      amount: tipText(item.amount),
    }),
  }[item.kind]
  return (
    <Stack
      spacing={1.5}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={onOpen}
    >
      {isNew && (
        <Text fontSize="sm" fontWeight={500} color={LINK}>
          ● {t('New')}
        </Text>
      )}
      <HStack spacing={2.5} align="center">
        <PersonAvatar address={item.actor} boxSize={10} rounded="md" />
        <Text fontSize="md">
          <NameLink address={item.actor} onProfile={onProfile} /> {action}
          <Text as="span" color={MUTED}>{`  ·  ${timeAgo(
            item.time,
            now
          )}`}</Text>
        </Text>
      </HStack>
      <Box color={MUTED}>
        <PostText message={item.what.message} lines={2} />
      </Box>
      {item.answer && (
        <>
          <Divider />
          <PostBody call={item.answer} lines={4} media={false} />
        </>
      )}
    </Stack>
  )
}

export const notifyKindLabels = (t) => ({
  [NotifyKind.Likes]: t('Likes'),
  [NotifyKind.Comments]: t('Comments'),
  [NotifyKind.Tips]: t('Tips'),
})

/** One entry of a profile list as the phone's card: what it answered, liked or tipped, then the post. */
export function ProfileItemCard({item, tab, now, onOpen, onProfile}) {
  const {t} = useTranslation()
  const {names} = useSocial()
  const {node, parent, like, tip} = item
  let context = null
  if (like)
    context = `${LIKE} ${t('Liked {{name}}', {
      name: displayName(node.call.author, names),
    })}  ·  ${timeAgo(like.time, now)}`
  else if (tip)
    context = `🪙 ${t('Tipped {{amount}} iDNA to {{name}}', {
      amount: tipText(validTipAmount(tip)),
      name: displayName(node.call.author, names),
    })}  ·  ${timeAgo(tip.time, now)}`
  else if (parent)
    context =
      tab === 'replies'
        ? t('Reply to {{name}}', {name: displayName(parent.author, names)})
        : t('Comment on {{name}}', {name: displayName(parent.author, names)})
  const showHeader = !like && !tip
  return (
    <Stack
      spacing={1.5}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={onOpen}
    >
      {context && <SmallText>{context}</SmallText>}
      {parent && showHeader && (
        <>
          <Box color={MUTED}>
            <PostBody call={parent} lines={2} media={false} />
          </Box>
          <Divider />
        </>
      )}
      {showHeader && (
        <FullHeader
          address={node.call.author}
          time={node.call.time}
          now={now}
          onProfile={onProfile}
        />
      )}
      <PostBody
        call={node.call}
        lines={showHeader ? FEED_TEXT_LINES : 4}
        maxH="360px"
        media={tab === 'media'}
      />
      <SmallText>
        {`♡ ${likeCount(node)}  ·  💬 ${replyCount(node)}  ·  🪙 ${tipText(
          tipTotal(node)
        )}`}
      </SmallText>
    </Stack>
  )
}
