/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {FLIP_STEPS} from './drafts'

// A Flips step waiting in To approve (B-258): the draft it made, as the person judges it. The pictures a step drew,
// or the flip protected in its two orders (the story's, then the shuffled one).

function Row({label, images}) {
  return (
    <Stack spacing={1}>
      <Text fontSize="sm" color="muted">
        {label}
      </Text>
      <Flex gap={1} wrap="wrap">
        {images.map((src, i) =>
          src ? (
            <Box
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              as="img"
              src={src}
              alt=""
              w="120px"
              h="90px"
              objectFit="cover"
              borderRadius="sm"
            />
          ) : (
            <Box
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              w="120px"
              h="90px"
              borderRadius="sm"
              borderWidth={1}
              borderStyle="dashed"
              borderColor="gray.100"
            />
          )
        )}
      </Flex>
    </Stack>
  )
}

/** The pictures of `list` in `order` (slot numbers). */
const inOrder = (list, order) =>
  (Array.isArray(order) ? order : []).map((slot) => (list || [])[slot] || null)

export function FlipPreview({item}) {
  const {t} = useTranslation()
  if (!FLIP_STEPS.includes(item.action) || item.action === 'flipStory')
    return null
  const flipId = item.target && item.target.flipId
  const flip = flipId && global.flipStore && global.flipStore.getFlip(flipId)
  if (!flip)
    return (
      <Text fontSize="sm" color="muted">
        {t('The draft is gone.')}
      </Text>
    )
  if (item.action === 'flipPictures')
    return (
      <Row
        label={t('Its pictures, in the story order')}
        images={inOrder(flip.images, flip.originalOrder)}
      />
    )
  return (
    <Stack spacing={2}>
      <Row
        label={t('The story order')}
        images={inOrder(flip.protectedImages, flip.originalOrder)}
      />
      <Row
        label={t('The shuffled order')}
        images={inOrder(flip.protectedImages, flip.order)}
      />
    </Stack>
  )
}
