/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {HStack, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {shortAddress} from '../people'
import {identityColor, identityLabel} from '../format'
import {useIdentities} from '../profile-hooks'
import {PersonAvatar, useShownName} from '../components/profile-public'

// A profile's tabs "Invitees" and "Members" (profile-lists.js), as the phone app's: each account with its picture
// or robot, its name and its identity state; a click opens its profile.

function PersonRow({address, identity, onOpen}) {
  const name = useShownName(address)
  return (
    <HStack
      spacing={3}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={() => onOpen(address)}
    >
      <PersonAvatar address={address} boxSize={10} rounded="md" />
      <Stack spacing={0} flex={1} minW={0}>
        <Text fontWeight={500} noOfLines={1}>
          {name || shortAddress(address)}
        </Text>
        {identity && (
          <Text
            fontSize="sm"
            color={identityColor(identity.state) || 'muted'}
            noOfLines={1}
          >
            {identityLabel(identity.state, identity.age)}
          </Text>
        )}
      </Stack>
    </HStack>
  )
}

/**
 * The accounts of one of the lists (`addresses`, read by the caller: `isLoading`, `error`), with their identities
 * read in one batch; `empty` when there is none.
 */
export function ProfilePeople({addresses, isLoading, error, empty, onOpen}) {
  const {t} = useTranslation()
  const identities = useIdentities(addresses)
  const failed = error || identities.error
  if (failed)
    return (
      <SmallText>
        {t('The node did not answer: {{message}}', {
          message: failed.message,
          nsSeparator: '|',
        })}
      </SmallText>
    )
  if (isLoading) return <SmallText>{t('Asking the node…')}</SmallText>
  if (addresses.length === 0) return <SmallText>{empty}</SmallText>
  return (
    <Stack spacing={2}>
      {addresses.map((address) => (
        <PersonRow
          key={address}
          address={address}
          identity={identities.data?.[address]}
          onOpen={onOpen}
        />
      ))}
    </Stack>
  )
}
