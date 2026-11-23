/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Button,
  Flex,
  HStack,
  Image,
  Input,
  InputGroup,
  InputLeftAddon,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {activeBan} from '../moderation'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {socialRpc} from '../node'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {timeAgo} from '../format'
import {pickMedia} from '../image'
import {IMAGE_TYPE, fromWei, storeFeeHint} from '../posting'
import {MAX_POST_MEDIA} from '../contract'
import {MediaKind, kindOfType} from '../media-type'
import {
  MAX_VOICE_BYTES,
  MAX_VOICE_MS,
  playTime,
  useVoiceRecorder,
} from '../voice'
import {DraftKind} from '../sending'
import {TOPIC_PREFIX, topicChannel, topicList, typedTopic} from '../topics'
import {useAutoGrow} from './auto-grow'
import {Chip} from './chips'
import {PostText} from './post'
import {MUTED} from './theme'

/** The node's fee per gas, once: the image's cost before the node estimates it. */
function useFeePerGas() {
  const [feePerGas, setFeePerGas] = React.useState(null)
  React.useEffect(() => {
    let alive = true
    socialRpc('bcn_feePerGas')
      .then((value) => alive && setFeePerGas(value))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return feePerGas
}

/**
 * A draft's file sent as it is (B-222): a moving picture, a video or a sound, its weight and what storing it costs
 * (nothing when `selfHosted`); `onEarlier` moves it before the one above.
 */
function DraftFile({image, url, feePerGas, onRemove, onEarlier, selfHosted}) {
  const {t} = useTranslation()
  const kind = kindOfType(image.type)
  const size = Math.ceil(image.bytes.length / 1000)
  return (
    <Stack spacing={2}>
      {kind === MediaKind.Video && (
        <Box
          as="video"
          src={url}
          controls
          preload="metadata"
          maxH="300px"
          maxW="full"
          rounded="lg"
        />
      )}
      {kind === MediaKind.Audio && (
        <Box as="audio" src={url} controls w="full" />
      )}
      {kind !== MediaKind.Video && kind !== MediaKind.Audio && (
        <Image
          src={url}
          alt=""
          maxH="300px"
          maxW="full"
          objectFit="contain"
          rounded="lg"
          alignSelf="flex-start"
        />
      )}
      <HStack spacing={2} flexWrap="wrap">
        <Chip isSelected>{t('{{size}} KB', {size})}</Chip>
        <Chip onClick={onRemove}>✕ {t('Remove it')}</Chip>
        {onEarlier && <Chip onClick={onEarlier}>↑ {t('Move up')}</Chip>}
      </HStack>
      <SmallText>
        {selfHosted
          ? t(
              'Hosted by your node: no storage fee. The file is sent as it is; an MP4 or M4A file is sent without its details (place, camera, title), another file keeps its own.',
              {nsSeparator: '|'}
            )
          : t(
              "It is stored on IPFS (a storeToIpfs transaction): {{fee}}, on top of the post's fee. The file is sent as it is; an MP4 or M4A file is sent without its details (place, camera, title), another file keeps its own.",
              {
                fee:
                  feePerGas === null
                    ? t('a fee that grows with its size')
                    : t('about {{fee}} iDNA', {
                        fee: fromWei(
                          storeFeeHint(feePerGas, image.bytes.length),
                          2,
                          true
                        ),
                      }),
                nsSeparator: '|',
              }
            )}
      </SmallText>
    </Stack>
  )
}

/**
 * A media of the draft: its preview, the sizes to choose from, and what storing it costs (nothing when `selfHosted`);
 * a file sent as it is apart. `onEarlier` moves it before the one above.
 */
function DraftImage({image, onSide, onRemove, onEarlier, selfHosted}) {
  const {t} = useTranslation()
  const url = React.useMemo(
    () =>
      URL.createObjectURL(
        new Blob([image.bytes], {type: image.type || IMAGE_TYPE})
      ),
    [image.bytes, image.type]
  )
  React.useEffect(() => () => URL.revokeObjectURL(url), [url])
  const feePerGas = useFeePerGas()
  if (image.asIs)
    return (
      <DraftFile
        image={image}
        url={url}
        feePerGas={feePerGas}
        onRemove={onRemove}
        onEarlier={onEarlier}
        selfHosted={selfHosted}
      />
    )
  return (
    <Stack spacing={2}>
      <Image
        src={url}
        alt=""
        maxH="300px"
        maxW="full"
        objectFit="contain"
        rounded="lg"
        alignSelf="flex-start"
      />
      <HStack spacing={2} flexWrap="wrap">
        {image.sides.map(({side, bytes}) => (
          <Chip
            key={side}
            isSelected={side === image.side}
            onClick={() => onSide(side)}
          >
            {t('{{side}} px · {{size}} KB', {
              side,
              size: Math.ceil(bytes.length / 1000),
            })}
          </Chip>
        ))}
        <Chip onClick={onRemove}>✕ {t('Remove the image')}</Chip>
        {onEarlier && <Chip onClick={onEarlier}>↑ {t('Move up')}</Chip>}
      </HStack>
      {image.stillInstead > 0 && (
        <SmallText>
          {t(
            'Too large to send moving ({{size}} KB, at most 900 KB): it is sent as a still picture.',
            {size: image.stillInstead, nsSeparator: '|'}
          )}
        </SmallText>
      )}
      <SmallText>
        {selfHosted &&
          t(
            "Hosted by your node: no storage fee. It is sent as WebP, without the photo's details (place, camera).",
            {nsSeparator: '|'}
          )}
        {!selfHosted && feePerGas === null
          ? t(
              "The image is stored on IPFS (a storeToIpfs transaction): a fee that grows with its size, on top of the post's fee. It is sent as WebP, without the photo's details (place, camera).",
              {nsSeparator: '|'}
            )
          : !selfHosted &&
            t(
              "The image is stored on IPFS (a storeToIpfs transaction): about {{fee}} iDNA, on top of the post's fee. It is sent as WebP, without the photo's details (place, camera).",
              {
                fee: fromWei(
                  storeFeeHint(feePerGas, image.bytes.length),
                  2,
                  true
                ),
                nsSeparator: '|',
              }
            )}
      </SmallText>
    </Stack>
  )
}

/**
 * Where the draft's files are kept (B-311): stored by the network (a storeToIpfs transaction each, with its fee, the
 * default), or hosted by this node alone, without that fee.
 */
function HostingChoice({selfHosted, onChange}) {
  const {t} = useTranslation()
  return (
    <Stack spacing={1}>
      <HStack spacing={2} flexWrap="wrap">
        <Chip isSelected={!selfHosted} onClick={() => onChange(false)}>
          {t('Stored by the network')}
        </Chip>
        <Chip isSelected={selfHosted} onClick={() => onChange(true)}>
          {t('Hosted by my node')}
        </Chip>
      </HStack>
      <SmallText color={MUTED}>
        {selfHosted
          ? t(
              'No storage fee: your node keeps the files. Others see them while your node is online.',
              {nsSeparator: '|'}
            )
          : t(
              'The network keeps the files: about one node in five stores each of them, for a fee that grows with its size.',
              {nsSeparator: '|'}
            )}
      </SmallText>
    </Stack>
  )
}

const MAX_OFFERED_TOPICS = 8

/** The Topic field of a new post: blank for none; the topics read that match are offered. */
function TopicField({value, onChange}) {
  const {t} = useTranslation()
  const {feed} = useSocial()
  const typed = value.trim()
  const valid = typed === '' || typedTopic(typed) !== null
  const offered = React.useMemo(
    () =>
      topicList(feed, typed)
        .map(({name}) => name)
        .filter((name) => name !== typedTopic(typed))
        .slice(0, MAX_OFFERED_TOPICS),
    [feed, typed]
  )
  return (
    <Stack spacing={2}>
      <InputGroup size="sm">
        <InputLeftAddon>{TOPIC_PREFIX}</InputLeftAddon>
        <Input
          value={value}
          maxLength={40}
          placeholder={t('Topic (optional)')}
          isInvalid={!valid}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputGroup>
      <SmallText color={valid ? MUTED : 'red.500'}>
        {valid
          ? t(
              'Shown with the topic in our apps and on the Idena Social website.'
            )
          : t('a-z, 0-9 and _, 3 to 21 characters')}
      </SmallText>
      {offered.length > 0 && (
        <HStack spacing={2} flexWrap="wrap">
          {offered.map((name) => (
            <Chip key={name} onClick={() => onChange(name)}>
              {topicChannel(name)}
            </Chip>
          ))}
        </HStack>
      )}
    </Stack>
  )
}

/**
 * The editor of a post, a reply or a comment, as the phone app's: the text, up to MAX_POST_MEDIA media (an image in
 * WebP, size to choose, a video, a sound; B-311), the text on IPFS if wanted, where the files are kept (the network,
 * with a fee, or this node alone), and Post, which shows the fees before anything is sent. Cancel keeps the draft.
 */
/** The editor of the open draft; `underThread`: pinned under the thread it answers, so it starts smaller. */
export function Editor({now, status, underThread = false}) {
  const {t} = useTranslation()
  const {names, sending, me, communityModeration, moderation, epoch} =
    useSocial()
  // With Community moderation on, a banned account is told before paying: its posts are not shown (B-308).
  const myBan = communityModeration
    ? activeBan(moderation.state, me, epoch?.epoch ?? null)
    : null
  const {
    draft,
    draftText,
    setDraftText,
    draftMedia,
    setDraftMedia,
    selfHosted,
    setSelfHosted,
    textOnIpfs,
    setTextOnIpfs,
    draftTopic,
    setDraftTopic,
  } = sending
  const [preparing, setPreparing] = React.useState(false)
  const [imageNote, setImageNote] = React.useState(null)
  const fileRef = React.useRef()
  const audioRef = React.useRef()
  // Each media gets a key of its own: two equal files stay apart in the list. The draft outlives the editor
  // (Cancel keeps it), so the keys go on above those it holds.
  const keyRef = React.useRef(0)
  const withKey = (item) => {
    keyRef.current =
      Math.max(keyRef.current, ...draftMedia.map(({key}) => key ?? 0)) + 1
    return {...item, key: keyRef.current}
  }
  const full = draftMedia.length >= MAX_POST_MEDIA
  const voice = useVoiceRecorder((result) => {
    if (result.error) setImageNote(result.error)
    else {
      setImageNote(null)
      // A limit reached is said under the editor while this note is in the draft (`voiceLimit`).
      setDraftMedia((current) =>
        [
          ...current,
          withKey({
            asIs: true,
            type: result.type,
            bytes: result.bytes,
            voiceLimit: result.limited,
          }),
        ].slice(0, MAX_POST_MEDIA)
      )
    }
  })
  const textRef = React.useRef()
  useAutoGrow(
    textRef,
    draftText,
    underThread ? {min: 96, maxShare: 0.35} : undefined
  )

  const titles = {
    [DraftKind.Post]: t('New post'),
    [DraftKind.Reply]: t('Reply'),
    [DraftKind.Comment]: t('Comment'),
  }
  const isPost = draft.kind === DraftKind.Post
  const topicValid =
    !isPost || draftTopic.trim() === '' || typedTopic(draftTopic) !== null
  const canPost =
    sending.canAct &&
    topicValid &&
    (draftText.trim() !== '' || draftMedia.length > 0) &&
    !preparing &&
    !voice.recording

  // The files picked, added after the draft's media while there is room; a file that cannot be used is said.
  const pickFiles = async (files, audio = false) => {
    const room = MAX_POST_MEDIA - draftMedia.length
    const picked = Array.from(files || [])
    if (picked.length === 0 || room <= 0) return
    setPreparing(true)
    setImageNote(null)
    const added = []
    const notes = []
    for (const file of picked.slice(0, room)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        added.push(withKey(await pickMedia(file, {audio})))
      } catch (error) {
        notes.push(
          picked.length > 1 ? `${file.name}: ${error.message}` : error.message
        )
      }
    }
    if (picked.length > room)
      notes.push(
        t('only {{number}} more media fit in a post', {
          number: room,
          nsSeparator: '|',
        })
      )
    setDraftMedia((current) => [...current, ...added].slice(0, MAX_POST_MEDIA))
    setImageNote(notes.length > 0 ? notes.join('; ') : null)
    setPreparing(false)
  }
  const replaceAt = (index, item) =>
    setDraftMedia((current) =>
      current.map((other, i) => (i === index ? item : other))
    )
  const removeAt = (index) =>
    setDraftMedia((current) => current.filter((_, i) => i !== index))
  const moveUp = (index) =>
    setDraftMedia((current) => {
      const next = [...current]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })

  const {answered} = draft
  return (
    <Stack spacing={3} w="full">
      <Flex align="center" justify="space-between">
        <SecondaryButton onClick={sending.cancelDraft}>
          {t('Cancel')}
        </SecondaryButton>
        <Text fontWeight={500} fontSize="lg">
          {titles[draft.kind]}
        </Text>
        <PrimaryButton isDisabled={!canPost} onClick={sending.prepareDraft}>
          {t('Post')}
        </PrimaryButton>
      </Flex>
      {status}
      {answered && (
        <Box borderLeftWidth={2} borderColor="gray.100" pl={3}>
          <SmallText>
            {`${displayName(answered.author, names)}  ·  ${timeAgo(
              answered.time,
              now
            )}`}
          </SmallText>
          <PostText message={answered.message} lines={3} />
        </Box>
      )}
      {isPost && <TopicField value={draftTopic} onChange={setDraftTopic} />}
      <Textarea
        ref={textRef}
        autoFocus
        value={draftText}
        resize="none"
        placeholder={isPost ? t("What's new?") : t('Your answer')}
        onChange={(e) => setDraftText(e.target.value)}
      />
      {draftMedia.map((item, index) => (
        <DraftImage
          key={item.key}
          image={item}
          selfHosted={selfHosted}
          onSide={(side) =>
            replaceAt(index, {
              ...item,
              side,
              bytes: item.sides.find((other) => other.side === side).bytes,
            })
          }
          onRemove={() => removeAt(index)}
          onEarlier={index > 0 ? () => moveUp(index) : null}
        />
      ))}
      {preparing && <SmallText>{t('Preparing the image…')}</SmallText>}
      {draftMedia.some((item) => item.voiceLimit === 'size') && (
        <SmallText>
          {t(
            'The recording stopped at its limit: the {{size}} KB a voice note can hold.',
            {size: Math.floor(MAX_VOICE_BYTES / 1000), nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {draftMedia.some((item) => item.voiceLimit === 'time') && (
        <SmallText>
          {t('The recording stopped at its limit: {{minutes}} minutes.', {
            minutes: MAX_VOICE_MS / 60000,
            nsSeparator: '|',
          })}
        </SmallText>
      )}
      {imageNote && (
        <Text fontSize="sm" color="red.500">
          {t('This file cannot be used: {{message}}', {
            message: imageNote,
            nsSeparator: '|',
          })}
        </Text>
      )}
      <HStack spacing={2} flexWrap="wrap">
        <Button
          size="sm"
          variant="outline"
          borderColor="gray.100"
          isDisabled={preparing || voice.recording || full}
          onClick={() => fileRef.current?.click()}
        >
          🖼 {t('Image or video')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            pickFiles(files)
          }}
        />
        <Button
          size="sm"
          variant="outline"
          borderColor="gray.100"
          isDisabled={preparing || voice.recording || full}
          onClick={() => audioRef.current?.click()}
        >
          🎵 {t('Sound file')}
        </Button>
        <input
          ref={audioRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            pickFiles(files, true)
          }}
        />
        <Button
          size="sm"
          variant="outline"
          borderColor="gray.100"
          // A recording joins the draft's media while there is room.
          isDisabled={preparing || (!voice.recording && full)}
          onClick={() => {
            setImageNote(null)
            if (voice.recording) voice.stop()
            else voice.start()
          }}
        >
          {voice.recording
            ? t('⏹ Stop ({{time}})', {time: playTime(voice.elapsed)})
            : t('🎙 Record')}
        </Button>
        <Chip
          isSelected={textOnIpfs}
          onClick={() => setTextOnIpfs(!textOnIpfs)}
        >
          {t('Text on IPFS')}
        </Chip>
      </HStack>
      {textOnIpfs && (
        <SmallText>
          {selfHosted
            ? t(
                'The text is hosted by your node, without a storage fee, and the post holds its address. It stays readable while your node is online.'
              )
            : t(
                'The text is stored on IPFS (a storeToIpfs transaction, cheaper than the post for long texts) and the post holds its address. It stays readable while IPFS nodes keep it.'
              )}
        </SmallText>
      )}
      {(draftMedia.length > 0 || textOnIpfs || selfHosted) && (
        <HostingChoice selfHosted={selfHosted} onChange={setSelfHosted} />
      )}
      {myBan && (
        <SmallText color="red.500">
          {myBan.permanent
            ? t(
                "Your account is banned permanently by the community moderators: your posts won't be shown on Idena Social.",
                {nsSeparator: '|'}
              )
            : t(
                "Your account is banned until epoch {{epoch}} by the community moderators: your posts won't be shown on Idena Social.",
                {epoch: myBan.endEpoch, nsSeparator: '|'}
              )}
        </SmallText>
      )}
      <SmallText color={MUTED}>
        {t(
          'Posts are public and stay on the blockchain for good. The fees are shown before sending.'
        )}
      </SmallText>
    </Stack>
  )
}
