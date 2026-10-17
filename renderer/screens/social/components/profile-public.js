/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Button,
  HStack,
  Image,
  Input,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import {
  Avatar,
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {useIpfsContent} from '../hooks'
import {useProfile, useTrust} from '../profile-hooks'
import {MAX_BIO, PROFILE_NAME, ProfileCall, profilesEnabled} from '../profiles'
import {ipfsCid} from '../calls'
import {displayName} from '../people'
import {IMAGE_TYPE} from '../posting'
import {encodePicture, isShowablePicture} from '../image'
import {Chip} from './chips'
import {MyVouching, VouchPanel} from './profile-vouch'

/** The image of an "ipfs://" picture, as a URL; null while it loads or when no node has it. */
function usePictureUrl(picture) {
  const cid = picture ? ipfsCid(picture) : null
  const {data} = useIpfsContent(cid)
  // A file the apps would not have made (too large, not a still WebP) is not shown: the robot stays.
  const url = React.useMemo(
    () =>
      isShowablePicture(data)
        ? URL.createObjectURL(new Blob([data], {type: IMAGE_TYPE}))
        : null,
    [data]
  )
  React.useEffect(() => () => url && URL.revokeObjectURL(url), [url])
  return url
}

/**
 * A person's picture: the profile's, while it is in good standing, with the robot as a badge (always beside a name:
 * a look-alike picture cannot hide whose address it is); the robot alone otherwise, or while the picture loads.
 * `props` go to the picture (rounded, cursor, onClick).
 */
export function ProfilePicture({address, profile, boxSize, ...props}) {
  const shown = profile?.inStanding ? profile.picture : null
  const url = usePictureUrl(shown)
  const rounded = props.rounded || 'lg'
  if (!url)
    return (
      <Avatar
        address={address}
        boxSize={boxSize}
        {...props}
        rounded={rounded}
      />
    )
  // The badge: about half the picture, a quarter of it overlapping the corner.
  const badge = Math.max(3, Math.round(boxSize * 0.45))
  return (
    <Box position="relative" flexShrink={0} {...props}>
      <Image
        src={url}
        boxSize={boxSize}
        rounded={rounded}
        objectFit="cover"
        alt=""
      />
      <Avatar
        address={address}
        boxSize={badge}
        position="absolute"
        right={-0.5}
        bottom={-0.5}
        bg="white"
        rounded="sm"
        borderWidth={1}
      />
    </Box>
  )
}

/** A person's picture (ProfilePicture) from the profiles read for everyone Social shows. */
export function PersonAvatar({address, ...props}) {
  const {profiles} = useSocial()
  return (
    <ProfilePicture
      address={address}
      profile={profiles?.[String(address).toLowerCase()]}
      {...props}
    />
  )
}

/** Trust or take it back, for a person or a topic ("r/<name>"): selected while the account's Trust is given. */
export function TrustButton({target}) {
  const {t} = useTranslation()
  const {me, sending} = useSocial()
  const {data: trust} = useTrust(target)
  if (!profilesEnabled) return null
  const mine = Boolean(trust?.givers.some((g) => g.address === me))
  // A Trust or its taking back waits for its block: the contract would refuse the next one.
  const waits =
    sending.isInFlight(ProfileCall.trust(target)) ||
    sending.isInFlight(ProfileCall.untrust(target))
  let label = mine ? t('Trusted') : t('Trust')
  if (waits) label = t('{{action}} · waiting for a block', {action: t('Trust')})
  return (
    <Chip
      isSelected={mine}
      isDisabled={!sending.canAct || !trust || waits}
      onClick={(e) => {
        e.stopPropagation()
        sending.prepareProfile(mine ? 'untrust' : 'trust', () =>
          mine ? ProfileCall.untrust(target) : ProfileCall.trust(target)
        )
      }}
    >
      {label}
    </Chip>
  )
}

/** "12 identities · 3 vouched members": how a Trust count splits. */
export function useTrustSplit() {
  const {t} = useTranslation()
  return (trust) =>
    [
      trust.identities === 1
        ? t('1 identity')
        : t('{{count}} identities', {count: trust.identities}),
      trust.vouched === 1
        ? t('1 vouched member')
        : t('{{count}} vouched members', {count: trust.vouched}),
    ].join(' · ')
}

/** "Trusted by 15": the givers counted now, identities and vouched members together; a click lists them. */
export function TrustLine({target, onProfile}) {
  const {t} = useTranslation()
  const {data: trust, isError} = useTrust(target)
  const [open, setOpen] = React.useState(false)
  if (!profilesEnabled) return null
  if (isError)
    return (
      <SmallText>
        {t('Trust: the node did not answer.', {nsSeparator: '|'})}
      </SmallText>
    )
  if (!trust)
    return <SmallText>{t('Trust: reading…', {nsSeparator: '|'})}</SmallText>
  const text =
    trust.counted.length === 0
      ? t('Trusted by nobody yet')
      : t('Trusted by {{count}}', {count: trust.counted.length})
  return (
    <>
      <Text
        as="button"
        textAlign="left"
        fontWeight={500}
        onClick={() => setOpen(true)}
        isDisabled={trust.counted.length === 0}
      >
        {`🤝 ${text}`}
      </Text>
      {open && (
        <TrustGiversDialog
          trust={trust}
          onProfile={(address) => {
            setOpen(false)
            onProfile(address)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** The givers of a Trust count: the split, the identities first, then the vouched members, marked. */
function TrustGiversDialog({trust, onProfile, onClose}) {
  const {t} = useTranslation()
  const {names} = useSocial()
  const split = useTrustSplit()
  const givers = [
    ...trust.counted.filter(({vouched}) => !vouched),
    ...trust.counted.filter(({vouched}) => vouched),
  ]
  return (
    <Dialog
      title={t('Trusted by {{count}}', {count: givers.length})}
      isOpen
      onClose={onClose}
    >
      <DialogBody>
        <Stack spacing={2} maxH="60vh" overflowY="auto">
          <SmallText>{split(trust)}</SmallText>
          {givers.map(({address, vouched}) => (
            <HStack
              key={address}
              spacing={2}
              cursor="pointer"
              onClick={() => onProfile(address)}
            >
              <PersonAvatar address={address} boxSize={8} rounded="md" />
              <Text>{displayName(address, names)}</Text>
              {vouched && <SmallText>{t('(vouched)')}</SmallText>}
            </HStack>
          ))}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * The public profile of `address` from the profiles contract: its name and its bio (the account's own profile edits
 * them from its ⚙ menu: ProfileEditDialog), then the vouching. Out of good standing it shows nothing, except to its
 * owner. The name line shows only when the title does not: the name hidden (the title shows it otherwise, B-72).
 * Its Trust is in the profile's header (profile-header.js).
 */
export function PublicProfile({address, isMe, profile}) {
  const {t} = useTranslation()
  if (!profilesEnabled) return null
  const shown = profile?.inStanding || isMe
  return (
    <Stack spacing={1} fontSize="md">
      {/* The title shows the claimed name while it is in good standing. */}
      {shown && profile?.name && !profile.inStanding && (
        <Text fontWeight={500}>
          {`@${profile.name}`}
          {!profile.inStanding &&
            ` · ${t('hidden: not validated, nor vouched for', {
              nsSeparator: '|',
            })}`}
        </Text>
      )}
      {shown && profile?.bio && (
        <Text whiteSpace="pre-wrap">{profile.bio}</Text>
      )}
      {isMe ? (
        <MyVouching profile={profile} />
      ) : (
        <VouchPanel address={address} profile={profile} />
      )}
    </Stack>
  )
}

/**
 * The account's public name, bio and picture, each change a call of its own: Save name (claimName), Drop the name
 * (dropName), Save the profile (setProfile, the picture stored on IPFS first). The confirmation shows the fees.
 */
export function ProfileEditDialog({profile, onClose}) {
  const {t} = useTranslation()
  const {sending} = useSocial()
  const [name, setName] = React.useState(profile?.name || '')
  const [bio, setBio] = React.useState(profile?.bio || '')
  const [picture, setPicture] = React.useState(null)
  const [removed, setRemoved] = React.useState(false)
  const [note, setNote] = React.useState(null)
  const fileRef = React.useRef()
  const newPictureUrl = React.useMemo(
    () =>
      picture
        ? URL.createObjectURL(new Blob([picture], {type: IMAGE_TYPE}))
        : null,
    [picture]
  )
  React.useEffect(
    () => () => newPictureUrl && URL.revokeObjectURL(newPictureUrl),
    [newPictureUrl]
  )
  const oldPictureUrl = usePictureUrl(removed ? null : profile?.picture)
  const cleanName = name.trim().replace(/^@/, '').toLowerCase()
  const nameValid = PROFILE_NAME.test(cleanName)
  const nameChanged = cleanName !== (profile?.name || '')
  const profileChanged =
    bio !== (profile?.bio || '') ||
    picture !== null ||
    (removed && Boolean(profile?.picture))

  // A name claimed or dropped, or a profile saved, waits for its block before the next (the contract allows one
  // name change an epoch, and a second call would pay a fee for nothing).
  const nameWaits = sending.kindInFlight('name', 'dropName')
  const profileWaits = sending.kindInFlight('profile')
  const saveName = () => {
    onClose()
    sending.prepareProfile('name', () => ProfileCall.claimName(cleanName), {
      detail: t('Claim the name @{{name}}', {name: cleanName}),
    })
  }
  const dropName = () => {
    onClose()
    sending.prepareProfile('dropName', () => ProfileCall.dropName(), {
      detail: t('Drop the name @{{name}}', {name: profile.name}),
    })
  }
  const saveProfile = () => {
    onClose()
    const kept = removed ? '' : profile?.picture || ''
    sending.prepareProfile(
      'profile',
      (stored) => ProfileCall.setProfile(bio.trim(), stored ?? kept),
      {image: picture}
    )
  }

  return (
    <Dialog title={t('Your public profile')} isOpen onClose={onClose}>
      <DialogBody>
        <Stack spacing={4}>
          <SmallText>
            {t(
              'Your name, bio and picture are public, for everyone using Idena, and each version stays in the blockchain history. Each save is a transaction with its fee.'
            )}
          </SmallText>
          <Stack spacing={1}>
            <Text fontWeight={500}>{t('Name')}</Text>
            <HStack>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="your_name"
                maxLength={21}
              />
              <PrimaryButton
                isDisabled={
                  !nameValid || !nameChanged || !sending.canAct || nameWaits
                }
                onClick={saveName}
              >
                {t('Save the name')}
              </PrimaryButton>
            </HStack>
            <SmallText color={name && !nameValid ? 'red.500' : undefined}>
              {t(
                'a-z, 0-9 and _, 3 to 20 characters. One name change per epoch; a name you leave stays blocked for 2 epochs.'
              )}
            </SmallText>
            {nameWaits && (
              <SmallText>
                {t('Your name change waits for its block.')}
              </SmallText>
            )}
            {profile?.name && (
              <Box>
                <Button
                  size="sm"
                  variant="ghost"
                  colorScheme="red"
                  onClick={dropName}
                  isDisabled={!sending.canAct || nameWaits}
                >
                  {t('Drop the name @{{name}}', {name: profile.name})}
                </Button>
              </Box>
            )}
          </Stack>
          <Stack spacing={1}>
            <Text fontWeight={500}>{t('Bio')}</Text>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
              rows={3}
            />
            <SmallText>{`${bio.length} / ${MAX_BIO}`}</SmallText>
          </Stack>
          <Stack spacing={1}>
            <Text fontWeight={500}>{t('Picture')}</Text>
            <HStack spacing={3}>
              {(newPictureUrl || oldPictureUrl) && (
                <Image
                  src={newPictureUrl || oldPictureUrl}
                  boxSize={16}
                  rounded="lg"
                  objectFit="cover"
                  alt=""
                />
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                {t('Choose a picture')}
              </Button>
              {(picture || (profile?.picture && !removed)) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPicture(null)
                    setRemoved(true)
                  }}
                >
                  {t('Remove the picture')}
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setNote(t('Preparing the picture…'))
                  try {
                    setPicture(await encodePicture(file))
                    setRemoved(false)
                    setNote(null)
                  } catch (error) {
                    setNote(
                      t('This picture cannot be used: {{message}}', {
                        message: error.message,
                        nsSeparator: '|',
                      })
                    )
                  }
                }}
              />
            </HStack>
            <SmallText>
              {note ||
                t(
                  'A square of 256 pixels, at most 32 KB, stored on IPFS (a storeToIpfs transaction with its own fee).'
                )}
            </SmallText>
          </Stack>
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
        <PrimaryButton
          isDisabled={!profileChanged || !sending.canAct || profileWaits}
          onClick={saveProfile}
        >
          {profileWaits
            ? t('{{action}} · waiting for a block', {
                action: t('Save the profile'),
              })
            : t('Save the profile')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * The name to show for `address` outside Social: the private one given in Social, else its claimed name ("@name")
 * while its holder is in good standing; null without either.
 */
export function useShownName(address) {
  const key = address ? String(address).toLowerCase() : null
  const {people} = useSocial()
  const {data: profile} = useProfile(key)
  const own = key ? people?.[key]?.name : null
  if (own) return own
  return profile?.inStanding && profile.name ? `@${profile.name}` : null
}

/** The name useShownName gives `address`, as a Text with `props`; nothing without one. */
export function ShownName({address, ...props}) {
  const name = useShownName(address)
  return name ? <Text {...props}>{name}</Text> : null
}
