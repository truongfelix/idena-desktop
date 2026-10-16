/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, Button, HStack, Image, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useIpfsContent} from '../hooks'
import {ipfsCid} from '../calls'
import {useSocial} from '../provider'
import {HiddenLine, PostMenu} from './hide-menu'
import {ActionBar} from './actions'
import {IdentityLabel, NameLink} from './identity'
import {MUTED} from './theme'
import {timeAgo} from '../format'
import {postTopic} from '../topics'
import {TopicLine, TopicTag} from './topic'
import {PersonAvatar} from './profile-public'

const textDecoder = new TextDecoder()

/** A post's text, from IPFS when idena.social stored it there; `lines` clamps it. */
export function PostText({message, lines}) {
  const {t} = useTranslation()
  const cid = ipfsCid(message)
  const {data, isLoading, isError, refetch} = useIpfsContent(cid)
  if (cid) {
    if (isLoading)
      return (
        <SmallText>
          {t('Loading the text from IPFS through the node…')}
        </SmallText>
      )
    if (isError || data === null)
      return (
        <HStack spacing={2}>
          <SmallText>
            {t('No longer available on IPFS: no node has it.', {
              nsSeparator: '|',
            })}
          </SmallText>
          <Button
            variant="link"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              refetch()
            }}
          >
            {t('Retry')}
          </Button>
        </HStack>
      )
  }
  const shown = cid ? textDecoder.decode(data) : message
  if (!shown) return null
  return (
    <Text
      fontSize="md"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      noOfLines={lines}
    >
      {shown}
    </Text>
  )
}

function MediaElement({src, type, maxH}) {
  if (type.startsWith('image/'))
    return (
      <Image
        src={src}
        alt=""
        maxH={maxH}
        maxW="full"
        objectFit="contain"
        rounded="lg"
        alignSelf="flex-start"
      />
    )
  return null
}

function IpfsMedia({cid, type, maxH}) {
  const {t} = useTranslation()
  const {data, isLoading, isError, refetch} = useIpfsContent(cid)
  const url = React.useMemo(
    () => (data ? URL.createObjectURL(new Blob([data], {type})) : null),
    [data, type]
  )
  React.useEffect(() => () => url && URL.revokeObjectURL(url), [url])
  if (isLoading)
    return (
      <SmallText>
        {t('Loading the image from IPFS through the node…')}
      </SmallText>
    )
  if (isError || !url)
    return (
      <HStack spacing={2}>
        <SmallText>
          {t('No longer available on IPFS: no node has it.', {
            nsSeparator: '|',
          })}
        </SmallText>
        <Button
          variant="link"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            refetch()
          }}
        >
          {t('Retry')}
        </Button>
      </HStack>
    )
  return <MediaElement src={url} type={type} maxH={maxH} />
}

/** A post's first media: inline (base64) or on IPFS. */
export function PostMedia({call: {hasMedia, media, mediaType}, maxH}) {
  const {t} = useTranslation()
  if (!hasMedia) return null
  const type = String(mediaType).toLowerCase()
  if (type === 'image/svg+xml')
    return <SmallText>{t('🖼 SVG image, not shown here.')}</SmallText>
  if (type.startsWith('video/') || type.startsWith('audio/'))
    return <SmallText>{t('🎞 Video or audio, not shown here.')}</SmallText>
  if (!type.startsWith('image/') || !media)
    return <SmallText>{t('🖼 Media')}</SmallText>
  const cid = ipfsCid(media)
  if (cid) return <IpfsMedia cid={cid} type={type} maxH={maxH} />
  if (media.startsWith('ipfs://')) return null
  return (
    <MediaElement
      src={`data:${type};base64,${media}`}
      type={type}
      maxH={maxH}
    />
  )
}

/**
 * A post's text (`lines` clamps it) and, with `media`, its first media; a text hidden (by the user, or with a hidden
 * word: a text on IPFS once fetched) shows as one line instead, a click shows it. Never one's own.
 */
export function PostBody({call, lines, maxH, media = true}) {
  const {me, hidden} = useSocial()
  const [shown, setShown] = React.useState(false)
  const cid = ipfsCid(call.message)
  // The same query as PostText's: fetched once.
  const {data} = useIpfsContent(cid)
  const own = call.author === me
  const byUser = !own && hidden.posts.has(String(call.hash).toLowerCase())
  let text = call.message
  if (cid) text = data ? textDecoder.decode(data) : ''
  const byWord = !own && hidden.words.matches(text)
  if (!shown && (byUser || byWord))
    return <HiddenLine byUser={byUser} onShow={() => setShown(true)} />
  return (
    <>
      <PostText message={call.message} lines={lines} />
      {media && <PostMedia call={call} maxH={maxH} />}
    </>
  )
}

/** How a post row shows the post's topic: as a tag under the author, in the author's place (Home), or not (the topic's page). */
export const TopicShown = {Tag: 'tag', InsteadOfAuthor: 'author', Not: 'not'}

/**
 * A post of the feed, as the phone app's rows: avatar, name, identity state in its color, time ago on one line
 * (or the post's topic in their place, `topicShown`), the text on 3 lines, the image, then the counters. A click
 * opens the thread.
 */
export function PostRow({
  node,
  now,
  onOpen,
  onProfile,
  topicShown = TopicShown.Tag,
}) {
  const {call} = node
  const topic = topicShown === TopicShown.Not ? null : postTopic(node)
  return (
    <Stack spacing={1.5} py={3} w="full">
      <Stack spacing={1} cursor="pointer" onClick={onOpen}>
        <HStack spacing={2} align="center">
          {topic !== null && topicShown === TopicShown.InsteadOfAuthor ? (
            <TopicLine name={topic} time={call.time} now={now} />
          ) : (
            <HStack spacing={2} align="center" minW={0}>
              <PersonAvatar
                address={call.author}
                boxSize={6}
                rounded="md"
                cursor="pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onProfile(call.author)
                }}
              />
              <Text fontSize="sm" noOfLines={1}>
                <NameLink address={call.author} onProfile={onProfile} />
                <Text as="span" color={MUTED}>
                  {'  ·  '}
                </Text>
                <IdentityLabel address={call.author} fontSize="sm" />
                <Text as="span" color={MUTED}>{`  ·  ${timeAgo(
                  call.time,
                  now
                )}`}</Text>
              </Text>
            </HStack>
          )}
          <Box flex={1} />
          <PostMenu call={call} />
        </HStack>
        {topic !== null && topicShown === TopicShown.Tag && (
          <TopicTag name={topic} />
        )}
        <PostBody call={call} lines={3} maxH="220px" />
      </Stack>
      <ActionBar node={node} onAnswers={onOpen} onProfile={onProfile} />
    </Stack>
  )
}

/** The color of "OP", Reddit's blue. */
const OP_BLUE = '#0079D3'

/**
 * The header of a thread item or a profile card: avatar, name and time, then the identity with its age. `isOp`:
 * the post's author on their replies and comments, "OP" after the name. With `call`, ⋯ after the time (PostMenu).
 */
export function FullHeader({
  address,
  time,
  now,
  onProfile,
  avatarSize = 9,
  onClick,
  isOp = false,
  call = null,
}) {
  return (
    <HStack
      spacing={2.5}
      align="center"
      onClick={onClick}
      cursor={onClick ? 'pointer' : undefined}
    >
      <PersonAvatar
        address={address}
        boxSize={avatarSize}
        rounded="md"
        cursor="pointer"
        onClick={(e) => {
          e.stopPropagation()
          onProfile(address)
        }}
      />
      <Stack spacing={0} flex={1} minW={0}>
        <HStack spacing={2} justify="space-between">
          <HStack spacing={2} minW={0}>
            <NameLink address={address} onProfile={onProfile} noOfLines={1} />
            {isOp && (
              <Text
                as="span"
                fontSize="sm"
                fontWeight={700}
                color={OP_BLUE}
                flexShrink={0}
              >
                OP
              </Text>
            )}
          </HStack>
          <HStack spacing={1} flexShrink={0}>
            <SmallText>{timeAgo(time, now)}</SmallText>
            {call && <PostMenu call={call} />}
          </HStack>
        </HStack>
        <IdentityLabel address={address} withAge fontSize="sm" />
      </Stack>
    </HStack>
  )
}
