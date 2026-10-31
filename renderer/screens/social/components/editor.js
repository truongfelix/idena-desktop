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
import {defaultSide, encodeImage} from '../image'
import {IMAGE_TYPE, fromWei, storeFeeHint} from '../posting'
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

/** The image of the draft: its preview, the sizes to choose from, and what storing it costs. */
function DraftImage({image, onSide, onRemove}) {
  const {t} = useTranslation()
  const url = React.useMemo(
    () => URL.createObjectURL(new Blob([image.bytes], {type: IMAGE_TYPE})),
    [image.bytes]
  )
  React.useEffect(() => () => URL.revokeObjectURL(url), [url])
  const feePerGas = useFeePerGas()
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
    !preparing

  const pickImage = async (file) => {
    if (!file) return
    setPreparing(true)
    setImageNote(null)
    try {
      const sides = await encodeImage(file)
      const side = defaultSide(sides.map((item) => item.side))
      setDraftImage({
        sides,
        side,
        bytes: sides.find((item) => item.side === side).bytes,
      })
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
      {imageNote && (
        <Text fontSize="sm" color="red.500">
          {t('This image cannot be used: {{message}}', {
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
          isDisabled={preparing}
          onClick={() => fileRef.current?.click()}
        >
          🖼 {draftImage ? t('Other image') : t('Image')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const [file] = e.target.files || []
            e.target.value = ''
            pickImage(file)
          }}
        />
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
