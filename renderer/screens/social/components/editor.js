/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Button,
  Flex,
  HStack,
  Image,
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

/**
 * The editor of a post, a reply or a comment, as the phone app's: the text, one image (WebP, size to choose), the
 * text on IPFS if wanted, and Post, which shows the fees before anything is sent. Cancel keeps the text and the
 * image for the next draft.
 */
export function Editor({now, status}) {
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
  } = sending
  const [preparing, setPreparing] = React.useState(false)
  const [imageNote, setImageNote] = React.useState(null)
  const fileRef = React.useRef()

  const titles = {
    [DraftKind.Post]: t('New post'),
    [DraftKind.Reply]: t('Reply'),
    [DraftKind.Comment]: t('Comment'),
  }
  const canPost =
    sending.canAct &&
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
      <Textarea
        autoFocus
        value={draftText}
        minH="120px"
        placeholder={
          draft.kind === DraftKind.Post ? t("What's new?") : t('Your answer')
        }
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
