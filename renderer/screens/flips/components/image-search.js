/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Center,
  Image,
  InputGroup,
  InputLeftElement,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {useMachine} from '@xstate/react'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  Input,
} from '../../../shared/components/components'
import {eitherState} from '../../../shared/utils/utils'
import {FillCenter} from '../../oracles/components'
import {SearchIcon} from '../../../shared/components/icons'
import {imageSearchMachine} from '../machines'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../../../shared/providers/settings-context'

/** What the web picture search sends where, and what making a flip does without it. */
function ImageSearchConsentText() {
  const {t} = useTranslation()
  return (
    <Stack spacing={3}>
      <Text>
        {t(
          'The search sends your words to DuckDuckGo, Openverse and Wikimedia from this computer, so they see its internet address and the words searched.'
        )}
      </Text>
      <Text>
        {t(
          'The pictures found also make the nonsense anti-AI picture. Without the search, it is made from your own pictures.'
        )}
      </Text>
      <Text color="muted">{t('You can change this in Settings.')}</Text>
    </Stack>
  )
}

/**
 * The web search for the nonsense picture's sources when a flip's pictures step opens (`loadAdversarial`):
 * it runs if the user allowed the search, waits for the answer to `consent` (the question's dialog) if never
 * asked, and is skipped if the search is off.
 */
export function useAdversarialSearch(currentSearch, sendSearch) {
  const {imageSearch} = useSettingsState()
  const {setImageSearch} = useSettingsDispatch()
  const [pendingQuery, setPendingQuery] = React.useState(null)

  const loadAdversarial = async (flip) => {
    if (
      flip.adversarialImages.some((x) => x) ||
      eitherState(currentSearch, 'searching')
    ) {
      return
    }
    const query = `${flip.keywords.words[0]?.name} ${flip.keywords.words[1]?.name}`
    if (imageSearch === true) {
      sendSearch('SEARCH', {query})
    } else if (imageSearch === undefined) {
      setPendingQuery(query)
    }
  }

  return {
    loadAdversarial,
    consent: {
      isOpen: pendingQuery !== null,
      onClose: () => setPendingQuery(null),
      onAnswer: (allowed) => {
        setImageSearch(allowed)
        if (allowed) sendSearch('SEARCH', {query: pendingQuery})
        setPendingQuery(null)
      },
    },
  }
}

/** Asks once whether pictures may be searched on the web; `onAnswer(allowed)`. */
export function ImageSearchConsentDialog({onAnswer, ...props}) {
  const {t} = useTranslation()
  return (
    <Dialog
      title={t('Search pictures on the web?')}
      closeOnOverlayClick={false}
      {...props}
    >
      <DialogBody>
        <ImageSearchConsentText />
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={() => onAnswer(false)}>
          {t("Don't search")}
        </SecondaryButton>
        <PrimaryButton onClick={() => onAnswer(true)}>
          {t('Allow search')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

export function ImageSearchDialog({onPick, onClose, onError, ...props}) {
  const {t} = useTranslation()

  const {imageSearch} = useSettingsState()
  const {setImageSearch} = useSettingsDispatch()

  const searchInputRef = React.useRef()

  const [current, send] = useMachine(imageSearchMachine, {
    actions: {
      onError: (_, {data: {message}}) => onError(message),
    },
  })

  const {images, query, selectedImage} = current.context

  if (imageSearch !== true) {
    const wasAsked = imageSearch === false
    return (
      <Dialog
        title={
          wasAsked
            ? t('Picture search is off')
            : t('Search pictures on the web?')
        }
        closeOnOverlayClick={false}
        onClose={onClose}
        {...props}
      >
        <DialogBody>
          <ImageSearchConsentText />
        </DialogBody>
        <DialogFooter>
          <SecondaryButton
            onClick={() => {
              if (!wasAsked) setImageSearch(false)
              onClose()
            }}
          >
            {wasAsked ? t('Cancel') : t("Don't search")}
          </SecondaryButton>
          <PrimaryButton onClick={() => setImageSearch(true)}>
            {wasAsked ? t('Turn on') : t('Allow search')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    )
  }

  return (
    <Dialog
      size="440"
      initialFocusRef={searchInputRef}
      closeOnOverlayClick={false}
      onClose={onClose}
      {...props}
    >
      <DialogBody display="flex">
        <Stack minH="sm" maxH="sm" spacing={4} flex={1}>
          <Stack
            isInline
            as="form"
            onSubmit={(e) => {
              e.preventDefault()
              send('SEARCH')
            }}
          >
            <InputGroup w="full">
              <InputLeftElement w={5} h={5} top="1.5" left={3}>
                <SearchIcon boxSize="5" color="gray.100" />
              </InputLeftElement>
              <Input
                ref={searchInputRef}
                type="search"
                value={query}
                placeholder={t('Search the picture on the web')}
                bg="gray.50"
                pl={10}
                onChange={(e) => {
                  send('TYPE', {query: e.target.value})
                }}
              />
            </InputGroup>
            <PrimaryButton type="submit">{t('Search')}</PrimaryButton>
          </Stack>

          {eitherState(current, 'idle') && (
            <FillCenter>
              <Stack spacing={4} align="center" w="3xs">
                <Box p={3}>
                  <SearchIcon boxSize="14" color="gray.300" />
                </Box>
                <Text color="muted" textAlign="center" w="full">
                  {t(
                    'Type your search in the box above to find images using search box'
                  )}
                </Text>
              </Stack>
            </FillCenter>
          )}

          {eitherState(current, 'done') && (
            <SimpleGrid
              columns={4}
              spacing={2}
              overflow="auto"
              px="8"
              sx={{
                marginInlineStart: '-32px !important',
                marginInlineEnd: '-32px !important',
              }}
            >
              {images.map(({thumbnail, image}, idx) => (
                <Center
                  key={`${image}-${idx}`}
                  h="88px"
                  w="88px"
                  bg={thumbnail === selectedImage ? 'blue.032' : 'white'}
                  borderColor={
                    thumbnail === selectedImage ? 'blue.500' : 'gray.50'
                  }
                  borderWidth={1}
                  borderRadius="md"
                  overflow="hidden"
                  transition="all 0.6s cubic-bezier(0.16, 1, 0.3, 1)"
                  onClick={() => {
                    send('PICK', {image: thumbnail})
                  }}
                  onDoubleClick={() => {
                    onPick(selectedImage)
                  }}
                >
                  <Image
                    src={thumbnail}
                    objectFit="contain"
                    objectPosition="center"
                    borderColor={
                      thumbnail === selectedImage ? 'blue.500' : 'transparent'
                    }
                    borderWidth={1}
                    borderRadius="md"
                    w="88px"
                  />
                </Center>
              ))}
            </SimpleGrid>
          )}
          {eitherState(current, 'searching') && (
            <FillCenter>
              <Spinner color="blue.500" />
            </FillCenter>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          onClick={() => {
            onPick(selectedImage)
          }}
        >
          {t('Select')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
