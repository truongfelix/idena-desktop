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
import {inviteeAddresses, inviterOf} from '../profile-lists'
import {useEpochState} from '../../../shared/providers/epoch-context'
import {EpochPeriod} from '../../../shared/types'
import {Action} from '../components/profile-vouch'
import {useShownName, useTrustSplit} from '../components/profile-public'
import {ProfileList} from './profile-header'
import {
  MyMembers,
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

/** Another's members; on one's own Members page, its members with End and the cap, then its offers waiting. */
function Members({address, isMe, onOpen}) {
  const {t} = useTranslation()
  const members = useMembers(isMe ? null : address)
  const addresses = React.useMemo(
    () => (members.data || []).map(({member}) => member),
    [members.data]
  )
  if (isMe)
    return (
      <>
        <MyMembers me={address} onOpen={onOpen} />
        <OffersSent me={address} onOpen={onOpen} />
      </>
    )
  return (
    <ProfilePeople
      addresses={addresses}
      isLoading={members.isLoading}
      error={members.error}
      empty={t('No vouched member.')}
      onOpen={onOpen}
    />
  )
}

/** The identity states whose invitation can still be terminated (KillInviteeTx). */
const TERMINABLE = ['Invite', 'Candidate']

/**
 * The invitees, after "Invited by <name>" (the profile's own inviter, while the node keeps the link). On one's own
 * page, an invitee still Invite or Candidate has Terminate, outside the validation only; its fee is shown first.
 */
function Invitees({isMe, identity, identityLoading, identityError, onOpen}) {
  const {t} = useTranslation()
  const {sending, names} = useSocial()
  const epoch = useEpochState()
  const outsideValidation = epoch?.currentPeriod === EpochPeriod.None
  const addresses = inviteeAddresses(identity)
  const inviter = inviterOf(identity)
  // The inviter's identity is read with the invitees'.
  const identities = useIdentities(
    inviter ? [inviter, ...addresses] : addresses
  )
  const terminate = (invitee) => {
    const state = identities.data?.[invitee]?.state
    if (!isMe || !TERMINABLE.includes(state)) return null
    const call = {contract: '', method: 'killInvitee', argument: invitee}
    return (
      <Action
        call={call}
        isDisabled={!sending.canAct || !outsideValidation}
        title={
          outsideValidation
            ? undefined
            : t('An invitation cannot be terminated during the validation.')
        }
        onClick={() =>
          sending.prepareTerminate(invitee, {
            title: t('Terminate the invitation of {{name}}?', {
              name: displayName(invitee, names),
            }),
            detail: t(
              'They can no longer validate with this invitation, and your invitation is not given back'
            ),
          })
        }
      >
        {t('Terminate')}
      </Action>
    )
  }
  return (
    <Stack spacing={2}>
      {inviter && (
        <>
          <Text fontWeight={600}>{t('Invited by')}</Text>
          <PersonRow
            address={inviter}
            identity={identities.data?.[inviter]}
            onOpen={onOpen}
          />
          <Text fontWeight={600} pt={2}>
            {t('Invitees')}
          </Text>
        </>
      )}
      {identityError && (
        <SmallText>
          {t('The node did not answer: {{message}}', {
            message: identityError.message,
            nsSeparator: '|',
          })}
        </SmallText>
      )}
      {identityLoading && <SmallText>{t('Asking the node…')}</SmallText>}
      {identity && addresses.length === 0 && (
        <SmallText>
          {t(
            'No invitee on the way: an invitee shows here from its invitation until it is Verified.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {addresses.map((invitee) => (
        <PersonRow
          key={invitee}
          address={invitee}
          identity={identities.data?.[invitee]}
          onOpen={onOpen}
          action={terminate(invitee)}
        />
      ))}
    </Stack>
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
        <Invitees
          isMe={isMe}
          identity={identity}
          identityLoading={identityLoading}
          identityError={identityError}
          onOpen={openProfile}
        />
      )}
    </Stack>
  )
}
