import React from 'react'
import {Box, Button, Center, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  HDivider,
} from '../../shared/components/components'
import {SecondaryButton} from '../../shared/components/button'
import {SettingsIcon} from '../../shared/components/icons'

/** The banner's item after the ads: the developer's note, as on the phone app. */
export const DEV_NOTE = 'dev-note'

/** What the banner rotates: the ads, then the developer's note. */
export function bannerItems(ads) {
  return [...(ads ?? []), DEV_NOTE]
}

/** The package this app belongs to: its GitHub repositories (their names say what each one is). */
export const PACKAGE = [
  'truongfelix/idena-go',
  'truongfelix/idena-desktop',
  'truongfelix/idena-mobile',
  'truongfelix/idena-profile',
]

/** The original code and the contributors, direct and indirect, with what the package owes them. */
const credits = (t) => [
  ['idena-network', t('the original Idena code, no longer maintained')],
  ['ubiubi18', t('the forks I started from, and code reviews')],
  ['N3CR0M4NC3R-dev/idena.social', t('Idena Social, the Social tab')],
]

/** Where the community talks (idena.social is the Social tab). */
const COMMUNITY = [
  ['Telegram', 'https://t.me/IdenaNetworkPublic'],
  ['Discord', 'https://discord.com/invite/idena-community-634481767352369162'],
]

/** The note's line in the banner: a click opens it. */
// eslint-disable-next-line react/prop-types
export function DevNoteBannerContent({onOpen}) {
  const {t} = useTranslation()

  return (
    <Stack
      isInline
      spacing={2}
      align="center"
      cursor="pointer"
      onClick={onOpen}
    >
      <Center w="10" h="10" bg="blue.012" color="blue.500" rounded="md">
        <SettingsIcon boxSize="5" />
      </Center>
      <Stack spacing="0.5" fontWeight={500} maxW={['2xs', 'lg']}>
        <Text lineHeight="4" noOfLines={1}>
          {t('A note from the dev')}
        </Text>
        <Text fontSize="sm" color="muted" lineHeight={4} isTruncated>
          {t('Community work, same chain as the original. Click to read.')}
        </Text>
      </Stack>
    </Stack>
  )
}

/** [name] as a link to [url], with [what] under it if given. */
// eslint-disable-next-line react/prop-types
function Link({name, url, what}) {
  return (
    <Box>
      <Button
        variant="link"
        colorScheme="blue"
        fontWeight={500}
        onClick={() => global.openExternal(url)}
      >
        {name}
      </Button>
      {what && (
        <Text fontSize="sm" color="muted">
          {what}
        </Text>
      )}
    </Box>
  )
}

/**
 * The developer's note: a community package, not the original team's; its repositories, the credits, the
 * dev's view on mining and reported flips, an invitation to help, and the avatars' credits.
 */
// eslint-disable-next-line react/prop-types
export function DevNoteDialog({isOpen, onClose}) {
  const {t} = useTranslation()

  return (
    <Dialog
      title={t('A note from the dev')}
      size="lg"
      scrollBehavior="inside"
      isOpen={isOpen}
      onClose={onClose}
    >
      <DialogBody>
        <Stack spacing={3}>
          <Text fontWeight={600}>
            {t(
              'Community work, not by the original Idena team. Same chain as the original.'
            )}
          </Text>
          <Stack spacing={1}>
            {PACKAGE.map((path) => (
              <Link key={path} name={path} url={`https://github.com/${path}`} />
            ))}
          </Stack>
          <Text>{t('Thanks to:', {nsSeparator: '|'})}</Text>
          {credits(t).map(([path, what]) => (
            <Link
              key={path}
              name={path}
              url={`https://github.com/${path}`}
              what={what}
            />
          ))}
          <HDivider />
          <Text>
            {t(
              'What I believe: today an identity that fails to solve flips loses mining rewards, but an identity whose flips get reported loses nothing. That is unfair, and it weakens the network.',
              {nsSeparator: '|'}
            )}
          </Text>
          <Text fontWeight={600}>
            {t(
              "The proposal: cut an identity's mining rewards in proportion to its share of reported flips over the last 10 epochs. Also, an identity with 2 or more flips reported in a validation can't mine during the next epoch. If you agree, say so on Telegram, Discord or Idena Social.",
              {nsSeparator: '|'}
            )}
          </Text>
          {COMMUNITY.map(([name, url]) => (
            <Link
              key={name}
              name={name}
              url={url}
              what={url.replace('https://', '')}
            />
          ))}
          <HDivider />
          <Text>
            {t(
              'Want to help? Feel free to fork the code, review it and propose changes on GitHub.'
            )}
          </Text>
          <Text fontSize="sm" color="muted">
            {t(
              'Robot avatars: RoboHash (MIT), robots by Zikri Kader (CC-BY 4.0), drawn by this app.',
              {nsSeparator: '|'}
            )}
          </Text>
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
      </DialogFooter>
    </Dialog>
  )
}
