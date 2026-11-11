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
import {PicturesMode} from '../hiding'
import {TopicTag} from './topic'
import {PersonAvatar} from './profile-public'
import {MediaKind, kindOfType, playableKind} from '../media-type'

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

// A click on a player plays it, and does not open the post.
const stop = (e) => e.stopPropagation()

/**
 * A post's media from `src`: a picture (a GIF or an animated WebP moves), or a video or a sound in the browser's
 * player, never playing by itself, and only when its file `bytes` is what the post declares (B-222).
 */
function MediaElement({src, type, maxH, bytes}) {
  const {t} = useTranslation()
  const kind = kindOfType(type)
  if (kind === MediaKind.Video || kind === MediaKind.Audio) {
    const playable = playableKind(type, bytes)
    if (!playable)
      return (
        <SmallText>
          {t(
            '🎞 This file is not the video or sound the post says: it is not played.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )
    return playable === MediaKind.Video ? (
      <Box
        as="video"
        src={src}
        controls
        preload="metadata"
        maxH={maxH}
        maxW="full"
        rounded="lg"
        alignSelf="flex-start"
        onClick={stop}
      />
    ) : (
      <Box as="audio" src={src} controls w="full" maxW="md" onClick={stop} />
    )
  }
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
        {kindOfType(type) === MediaKind.Picture ||
        kindOfType(type) === MediaKind.Animation
          ? t('Loading the image from IPFS through the node…')
          : t('Loading from IPFS through the node…')}
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
  return <MediaElement src={url} type={type} maxH={maxH} bytes={data} />
}

/**
 * A post's first media: inline (base64) or on IPFS. A video or a sound plays in its thread only (`inThread`): in a
 * list, a line says to open the post, and nothing is fetched.
 */
export function PostMedia({
  call: {hasMedia, media, mediaType},
  maxH,
  inThread = false,
}) {
  const {t} = useTranslation()
  if (!hasMedia) return null
  const type = String(mediaType).toLowerCase()
  if (type === 'image/svg+xml')
    return <SmallText>{t('🖼 SVG image, not shown here.')}</SmallText>
  const kind = kindOfType(type)
  const playable = kind === MediaKind.Video || kind === MediaKind.Audio
  if ((!type.startsWith('image/') && !playable) || !media)
    return <SmallText>{t('🖼 Media')}</SmallText>
  if (playable && !inThread)
    return (
      <SmallText>
        {kind === MediaKind.Video
          ? t('🎞 A video: open the post to play it.', {nsSeparator: '|'})
          : t('🎵 A sound: open the post to play it.', {nsSeparator: '|'})}
      </SmallText>
    )
  const cid = ipfsCid(media)
  if (cid) return <IpfsMedia cid={cid} type={type} maxH={maxH} />
  if (media.startsWith('ipfs://')) return null
  return <InlineMedia media={media} type={type} maxH={maxH} />
}

/** Media written in the post itself (base64); a video's or a sound's first bytes for the type check. */
function InlineMedia({media, type, maxH}) {
  const bytes = React.useMemo(() => {
    const kind = kindOfType(type)
    if (kind !== MediaKind.Video && kind !== MediaKind.Audio) return null
    try {
      // 88 base64 characters: 66 bytes, what sniffFormat reads (a WebM's type within 64).
      return Uint8Array.from(atob(media.slice(0, 88)), (c) => c.charCodeAt(0))
    } catch {
      return null
    }
  }, [media, type])
  return (
    <MediaElement
      src={`data:${type};base64,${media}`}
      type={type}
      maxH={maxH}
      bytes={bytes}
    />
  )
}

/**
 * Another's media with "Pictures in posts" at Click to show (TapToShow): one line, nothing downloaded; in a thread (`inThread`) a
 * click on it shows the media, in a list it says to open the post.
 */
function TapToShowMedia({call, maxH, inThread}) {
  const {t} = useTranslation()
  const [shown, setShown] = React.useState(false)
  if (shown) return <PostMedia call={call} maxH={maxH} inThread={inThread} />
  const kind = kindOfType(call.mediaType)
  if (!inThread)
    return (
      <SmallText>
        {kind === MediaKind.Video &&
          t('🎞 A video: open the post to play it.', {nsSeparator: '|'})}
        {kind === MediaKind.Audio &&
          t('🎵 A sound: open the post to play it.', {nsSeparator: '|'})}
        {kind !== MediaKind.Video &&
          kind !== MediaKind.Audio &&
          t('🖼 A picture: open the post to show it.', {nsSeparator: '|'})}
      </SmallText>
    )
  return (
    <Button
      variant="link"
      size="sm"
      alignSelf="flex-start"
      onClick={(e) => {
        e.stopPropagation()
        setShown(true)
      }}
    >
      {kind === MediaKind.Video && t('🎞 A video. Click to show it.')}
      {kind === MediaKind.Audio && t('🎵 A sound. Click to show it.')}
      {kind !== MediaKind.Video &&
        kind !== MediaKind.Audio &&
        t('🖼 A picture. Click to show it.')}
    </Button>
  )
}

/**
 * A post's text (`lines` clamps it) and, with `media`, its first media; a text hidden (by the user, or with a hidden
 * word: a text on IPFS once fetched) shows as one line instead, a click shows it. Never one's own. With "Pictures in
 * posts" at Click to show (TapToShow), another's media is one line (TapToShowMedia; `inThread`: the post's thread is open).
 */
export function PostBody({call, lines, maxH, media = true, inThread = false}) {
  const {me, hidden} = useSocial()
  const [shown, setShown] = React.useState(false)
  const cid = ipfsCid(call.message)
  // The same query as PostText's: fetched once.
  const {data} = useIpfsContent(cid)
  const own = call.author === me
  const byUser = !own && hidden.posts.has(String(call.hash).toLowerCase())
  // A text on IPFS is checked once fetched; an invalid reference is no text.
  let text = call.message.startsWith('ipfs://') ? '' : call.message
  if (cid && data) text = textDecoder.decode(data)
  const byWord = !own && hidden.words.matches(text)
  if (!shown && (byUser || byWord))
    return <HiddenLine byUser={byUser} onShow={() => setShown(true)} />
  return (
    <>
      <PostText message={call.message} lines={lines} />
      {media &&
        (hidden.pictures === PicturesMode.TapToShow && !own && call.hasMedia ? (
          <TapToShowMedia call={call} maxH={maxH} inThread={inThread} />
        ) : (
          <PostMedia call={call} maxH={maxH} inThread={inThread} />
        ))}
    </>
  )
}

/** The lines of a post's text shown in the lists (the feeds, a topic, a profile) before it is cut, as the phone's. */
export const FEED_TEXT_LINES = 8

/** How a post row shows the post's topic: as a tag under the author, or not (the topic's page). */
export const TopicShown = {Tag: 'tag', Not: 'not'}

/**
 * A post of the feed: avatar, name, identity state in its color, time ago on one line, the post's topic as a tag
 * (`topicShown`), the text on FEED_TEXT_LINES lines, the image, then the counters. A click opens the thread.
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
          <HStack spacing={2} align="center" minW={0}>
            <PersonAvatar
              address={call.author}
              boxSize={10}
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
          <Box flex={1} />
          <PostMenu call={call} />
        </HStack>
        {topic !== null && topicShown === TopicShown.Tag && (
          <TopicTag name={topic} />
        )}
        <PostBody call={call} lines={FEED_TEXT_LINES} maxH="220px" />
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
