/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {displayName, shortAddress} from '../people'
import {
  useIdentities,
  useMembers,
  useTrust,
  useTrustsGiven,
} from '../profile-hooks'
import {inviteeAddresses} from '../profile-lists'
import {useShownName, useTrustSplit} from '../components/profile-public'
import {ProfileList} from './profile-header'
import {
  OffersSent,
  PersonRow,
  ProfilePeople,
  TrustsGiven,
} from './profile-people'

// The page a profile's count opens (profile-header.js), titled "<name> · <list>", as the phone app's (B-89).

/** "Trusted by": the split, then the identities, then the vouched members, each "vouched by <name>". */
function TrustedBy({address, onOpen}) {
  const {t} = useTranslation()
  const {names} = useSocial()
  const split = useTrustSplit()
  const {data: trust, error} = useTrust(address)
  const counted = trust?.counted || []
  const identities = useIdentities(counted.map((giver) => giver.address))
  if (error)
    return (
      <SmallText>
        {t('The node did not answer: {{message}}', {
          message: error.message,
          nsSeparator: '|',
        })}
      </SmallText>
    )
  if (!trust) return <SmallText>{t('Asking the node…')}</SmallText>
  if (counted.length === 0)
    return <SmallText>{t("Nobody's Trust counts yet.")}</SmallText>
  const row = ({address: giver, voucher}) => (
    <PersonRow
      key={giver}
      address={giver}
      identity={identities.data?.[giver]}
      onOpen={onOpen}
      suffix={
        voucher
          ? ` · ${t('vouched by {{name}}', {
              name: displayName(voucher, names),
            })}`
          : ''
      }
    />
  )
  const vouched = counted.filter((giver) => giver.vouched)
  return (
    <Stack spacing={2}>
      <Text>{split(trust)}</Text>
      {trust.identities > 0 && (
        <Text fontWeight={600} pt={2}>
          {t('Identities')}
        </Text>
      )}
      {counted.filter((giver) => !giver.vouched).map(row)}
      {vouched.length > 0 && (
        <Text fontWeight={600} pt={2}>
          {t('Vouched members')}
        </Text>
      )}
      {vouched.map(row)}
    </Stack>
  )
}

function Members({address, isMe, onOpen}) {
  const {t} = useTranslation()
  const members = useMembers(address)
  const addresses = React.useMemo(
    () => (members.data || []).map(({member}) => member),
    [members.data]
  )
  return (
    <>
      <ProfilePeople
        addresses={addresses}
        isLoading={members.isLoading}
        error={members.error}
        empty={t('No vouched member.')}
        onOpen={onOpen}
      />
      {isMe && <OffersSent me={address} onOpen={onOpen} />}
    </>
  )
}

/** The list `list` (ProfileList) of the profile of `address`, under its title. */
export function ProfileListPage({
  address,
  list,
  isMe,
  identity,
  identityLoading,
  identityError,
  openProfile,
}) {
  const {t} = useTranslation()
  const name = useShownName(address) || shortAddress(address)
  const trustsGiven = useTrustsGiven(
    list === ProfileList.TrustsGiven ? address : null
  )
  const titles = {
    [ProfileList.TrustedBy]: t('Trusted by'),
    [ProfileList.TrustsGiven]: t('Trusts given'),
    [ProfileList.Members]: t('Members'),
    [ProfileList.Invitees]: t('Invitees'),
  }
  return (
    <Stack spacing={3} w="full">
      <Text fontSize="lg" fontWeight={500}>
        {`${name} · ${titles[list]}`}
      </Text>
      {list === ProfileList.TrustedBy && (
        <TrustedBy address={address} onOpen={openProfile} />
      )}
      {list === ProfileList.TrustsGiven && (
        <TrustsGiven trusts={trustsGiven} isMine={isMe} onOpen={openProfile} />
      )}
      {list === ProfileList.Members && (
        <Members address={address} isMe={isMe} onOpen={openProfile} />
      )}
      {list === ProfileList.Invitees && (
        <ProfilePeople
          addresses={inviteeAddresses(identity)}
          isLoading={identityLoading}
          error={identityError}
          empty={t(
            'No invitee on the way: an invitee shows here from its invitation until it is Verified.',
            {nsSeparator: '|'}
          )}
          onOpen={openProfile}
        />
      )}
    </Stack>
  )
}
