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
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {socialRpc} from '../node'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {timeAgo} from '../format'
import {pickMedia} from '../image'
import {IMAGE_TYPE, fromWei, storeFeeHint} from '../posting'
import {MediaKind, kindOfType} from '../media-type'
import {playTime, useVoiceRecorder} from '../voice'
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

/** A draft's file sent as it is (B-222): a moving picture, a video or a sound, its weight and what storing it costs. */
function DraftFile({image, url, feePerGas, onRemove}) {
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
      </HStack>
      <SmallText>
        {t(
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

/** The image of the draft: its preview, the sizes to choose from, and what storing it costs; a file sent as it is apart. */
function DraftImage({image, onSide, onRemove}) {
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
        {feePerGas === null
          ? t(
              "The image is stored on IPFS (a storeToIpfs transaction): a fee that grows with its size, on top of the post's fee. It is sent as WebP, without the photo's details (place, camera).",
              {nsSeparator: '|'}
            )
          : t(
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
              'Shown with the topic in our apps; the Idena Social website does not show posts in a topic.'
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
 * The editor of a post, a reply or a comment, as the phone app's: the text, one image (WebP, size to choose), the
 * text on IPFS if wanted, and Post, which shows the fees before anything is sent. Cancel keeps the text and the
 * image for the next draft.
 */
/** The editor of the open draft; `underThread`: pinned under the thread it answers, so it starts smaller. */
export function Editor({now, status, underThread = false}) {
  const {t} = useTranslation()
  const {names, sending} = useSocial()
  const {
    draft,
    draftText,
    setDraftText,
    draftImage,
    setDraftImage,
    textOnIpfs,
    setTextOnIpfs,
    draftTopic,
    setDraftTopic,
  } = sending
  const [preparing, setPreparing] = React.useState(false)
  const [imageNote, setImageNote] = React.useState(null)
  const fileRef = React.useRef()
  const audioRef = React.useRef()
  const voice = useVoiceRecorder((result) => {
    if (result.error) setImageNote(result.error)
    else {
      setImageNote(null)
      // A limit reached is said under the editor while this note is the draft's (`voiceLimit`).
      setDraftImage({
        asIs: true,
        type: result.type,
        bytes: result.bytes,
        voiceLimit: result.limited,
      })
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
    (draftText.trim() !== '' || draftImage !== null) &&
    imageNote === null &&
    !preparing &&
    !voice.recording

  const pickFile = async (file, audio = false) => {
    if (!file) return
    setPreparing(true)
    setImageNote(null)
    try {
      setDraftImage(await pickMedia(file, {audio}))
    } catch (error) {
      setImageNote(error.message)
    } finally {
      setPreparing(false)
    }
  }

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
      {draftImage && (
        <DraftImage
          image={draftImage}
          onSide={(side) =>
            setDraftImage({
              ...draftImage,
              side,
              bytes: draftImage.sides.find((item) => item.side === side).bytes,
            })
          }
          onRemove={() => setDraftImage(null)}
        />
      )}
      {preparing && <SmallText>{t('Preparing the image…')}</SmallText>}
      {draftImage?.voiceLimit === 'size' && (
        <SmallText>
          {t(
            'The recording stopped at its limit: the 900 KB a post can store.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {draftImage?.voiceLimit === 'time' && (
        <SmallText>
          {t('The recording stopped at its limit: 5 minutes.', {
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
          isDisabled={preparing || voice.recording}
          onClick={() => fileRef.current?.click()}
        >
          🖼 {draftImage ? t('Other image or video') : t('Image or video')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const [file] = e.target.files || []
            e.target.value = ''
            pickFile(file)
          }}
        />
        <Button
          size="sm"
          variant="outline"
          borderColor="gray.100"
          isDisabled={preparing || voice.recording}
          onClick={() => audioRef.current?.click()}
        >
          🎵 {t('Sound file')}
        </Button>
        <input
          ref={audioRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const [file] = e.target.files || []
            e.target.value = ''
            pickFile(file, true)
          }}
        />
        <Button
          size="sm"
          variant="outline"
          borderColor="gray.100"
          // One media per post: Record once the draft's picture or file is removed.
          isDisabled={preparing || (!voice.recording && draftImage !== null)}
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
          {t(
            'The text is stored on IPFS (a storeToIpfs transaction, cheaper than the post for long texts) and the post holds its address. It stays readable while IPFS nodes keep it.'
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
