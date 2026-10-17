/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, HStack, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {shortAddress} from '../people'
import {topicOf} from '../contract'
import {topicChannel} from '../topics'
import {identityColor, identityLabel} from '../format'
import {useIdentities, useOffersFrom} from '../profile-hooks'
import {ProfileCall} from '../profiles'
import {PersonAvatar, useShownName} from '../components/profile-public'
import {Action} from '../components/profile-vouch'
import {OpenTopicContext, TopicAvatar} from '../components/topic'

// The lists a profile's counts open (profile-list-page.js), as the phone app's: Invitees and Members
// (profile-lists.js), on one's own profile the vouch offers waiting, the Trusts given; each account with its picture
// or robot, its name and its identity state (`suffix` after it); a click opens its profile.

export function PersonRow({
  address,
  identity,
  onOpen,
  note = null,
  action = null,
  suffix = '',
}) {
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
            {suffix}
          </Text>
        )}
        {note && <SmallText>{note}</SmallText>}
      </Stack>
      {action && <Box onClick={(e) => e.stopPropagation()}>{action}</Box>}
    </HStack>
  )
}

/** Under one's own Members tab: the vouch offers waiting for an answer, each with Withdraw. */
export function OffersSent({me, onOpen}) {
  const {t} = useTranslation()
  const {sending} = useSocial()
  const offers = useOffersFrom(me)
  const addresses = React.useMemo(
    () => (offers.data || []).map(({member}) => member),
    [offers.data]
  )
  const identities = useIdentities(addresses)
  if (!offers.data || offers.data.length === 0) return null
  return (
    <Stack spacing={2} pt={2}>
      <Text fontWeight={500}>{t('Offers waiting')}</Text>
      {offers.data.map(({member, epoch}) => (
        <PersonRow
          key={member}
          address={member}
          identity={identities.data?.[member]}
          onOpen={onOpen}
          note={t('Offered in epoch {{epoch}}', {epoch})}
          action={
            <Action
              call={ProfileCall.cancelOffer(member)}
              onClick={() =>
                sending.prepareProfile(
                  'cancelOffer',
                  () => ProfileCall.cancelOffer(member),
                  {detail: t('Your offer to vouch for them ends')}
                )
              }
            >
              {t('Withdraw')}
            </Action>
          }
        />
      ))}
    </Stack>
  )
}

/** A topic given Trust: its picture and "r/name"; a click opens the topic. */
function TopicRow({name, action}) {
  const open = React.useContext(OpenTopicContext)
  return (
    <HStack
      spacing={3}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={() => open?.(name)}
    >
      <TopicAvatar name={name} boxSize={10} />
      <Text fontWeight={500} flex={1} minW={0} noOfLines={1}>
        {topicChannel(name)}
      </Text>
      <Box onClick={(e) => e.stopPropagation()}>{action}</Box>
    </HStack>
  )
}

/** The Trusts a profile gives, to people and topics (public on chain); on one's own (`isMine`) each with Take back. */
export function TrustsGiven({trusts, isMine, onOpen}) {
  const {t} = useTranslation()
  const {sending} = useSocial()
  const people = React.useMemo(
    () =>
      (trusts.data || [])
        .map(({target}) => target)
        .filter((target) => topicOf(target) === null),
    [trusts.data]
  )
  const identities = useIdentities(people)
  if (trusts.error)
    return (
      <SmallText>
        {t('The node did not answer: {{message}}', {
          message: trusts.error.message,
          nsSeparator: '|',
        })}
      </SmallText>
    )
  if (trusts.isLoading) return <SmallText>{t('Asking the node…')}</SmallText>
  if (!trusts.data || trusts.data.length === 0)
    return (
      <SmallText>
        {isMine
          ? t("You give no Trust yet: Trust on a profile or a topic's page.", {
              nsSeparator: '|',
            })
          : t('No Trust given.')}
      </SmallText>
    )
  const takeBack = (target) =>
    isMine ? (
      <Action
        call={ProfileCall.untrust(target)}
        onClick={() =>
          sending.prepareProfile('untrust', () => ProfileCall.untrust(target), {
            detail: t('Your Trust no longer counts'),
          })
        }
      >
        {t('Take back')}
      </Action>
    ) : null
  return (
    <Stack spacing={2}>
      {trusts.data.map(({target}) => {
        const topic = topicOf(target)
        return topic !== null ? (
          <TopicRow key={target} name={topic} action={takeBack(target)} />
        ) : (
          <PersonRow
            key={target}
            address={target}
            identity={identities.data?.[target]}
            onOpen={onOpen}
            action={takeBack(target)}
          />
        )
      })}
    </Stack>
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
