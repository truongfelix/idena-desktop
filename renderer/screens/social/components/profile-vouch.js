/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Button, HStack, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useEpochState} from '../../../shared/providers/epoch-context'
import {useSocial} from '../provider'
import {useChallenge, useOffer, useOffersTo, useProfile} from '../profile-hooks'
import {ProfileCall, isValidated, profilesEnabled} from '../profiles'
import {displayName} from '../people'
import {PersonAvatar} from './profile-public'
import {
  GRACE_EPOCHS,
  challengeStep,
  isActingMember,
  isVouchable,
  showsVoucher,
  vouchCap,
} from '../vouching'

/**
 * A small action button of the panel: disabled while another action is being prepared or sent, and while its own
 * `call` waits for its block ("… · waiting for a block": the contract would refuse it a second time).
 */
export function Action({children, call = null, onClick, isDisabled, ...props}) {
  const {t} = useTranslation()
  const {sending} = useSocial()
  const waits = call !== null && sending.isInFlight(call)
  return (
    <Button
      size="sm"
      variant="outline"
      isDisabled={(isDisabled ?? !sending.canAct) || waits}
      onClick={onClick}
      {...props}
    >
      {waits
        ? t('{{action}} · waiting for a block', {action: children})
        : children}
    </Button>
  )
}

/**
 * On another person's profile: who vouches for them; Vouch for them (an account without an identity, by a validated
 * one), the offer waiting, or End when the account vouches for them; and the challenge of a name its holder may no
 * longer hold (3 calls, one an epoch, in a row: the third gives the name to the challenger).
 */
export function VouchPanel({address, profile}) {
  const {t} = useTranslation()
  const {me, names, sending} = useSocial()
  const {data: mine} = useProfile(me)
  const {data: offer} = useOffer(address, me)
  const epoch = useEpochState()?.epoch ?? null
  const hiddenName = profile?.name && !profile.inStanding ? profile.name : null
  const {data: challenge} = useChallenge(hiddenName, me)
  if (!profilesEnabled || !profile || !me) return null
  const iVouch = profile.voucher === me
  const canOffer =
    !profile.voucher && isVouchable(profile.state) && isValidated(mine?.state)
  const step =
    hiddenName && epoch !== null
      ? challengeStep(challenge ?? null, epoch, address)
      : null
  const mayClaim = mine?.inStanding

  return (
    <Stack spacing={1}>
      {showsVoucher(profile) && (
        <Text>
          {iVouch
            ? t('You vouch for them.')
            : t('Vouched for by {{name}}', {
                name: displayName(profile.voucher, names),
              })}
          {!profile.inStanding &&
            profile.voucher &&
            ` ${t('(their voucher is not validated now)')}`}
        </Text>
      )}
      <HStack spacing={2} flexWrap="wrap">
        {/* The contract ends the vouch at the member's next call; End frees the slot now. */}
        {iVouch && !showsVoucher(profile) && (
          <SmallText>
            {t('has an identity now: End frees your slot', {
              nsSeparator: '|',
            })}
          </SmallText>
        )}
        {iVouch && (
          <Action
            call={ProfileCall.endVouch(address)}
            onClick={() =>
              sending.prepareProfile('endVouch', () =>
                ProfileCall.endVouch(address)
              )
            }
          >
            {t('End the vouch')}
          </Action>
        )}
        {canOffer && offer === null && (
          <Action
            call={ProfileCall.vouch(address)}
            onClick={() =>
              sending.prepareProfile(
                'vouch',
                () => ProfileCall.vouch(address),
                {
                  detail: t(
                    'They become a member once they accept; you vouch for at most {{cap}} members at a time',
                    {cap: vouchCap(mine.state)}
                  ),
                }
              )
            }
          >
            {t('Vouch for them')}
          </Action>
        )}
        {canOffer && offer !== null && offer !== undefined && (
          <>
            <SmallText>
              {t('Your offer waits for them to accept it.')}
            </SmallText>
            <Action
              call={ProfileCall.cancelOffer(address)}
              onClick={() =>
                sending.prepareProfile('cancelOffer', () =>
                  ProfileCall.cancelOffer(address)
                )
              }
            >
              {t('Withdraw the offer')}
            </Action>
          </>
        )}
      </HStack>
      {step && (
        <Stack spacing={1}>
          <SmallText>
            {t(
              'Its holder is neither validated nor vouched for. Challenging the name in {{count}} epochs in a row gives it to you; the holder keeps it by validating again meanwhile.',
              {count: GRACE_EPOCHS + 1}
            )}
          </SmallText>
          <HStack spacing={2}>
            <Action
              call={ProfileCall.challengeName(hiddenName)}
              isDisabled={!sending.canAct || !step.canCall || !mayClaim}
              onClick={() =>
                sending.prepareProfile(
                  'challenge',
                  () => ProfileCall.challengeName(hiddenName),
                  {
                    detail: step.frees
                      ? t('The third call: it gives you @{{name}}', {
                          name: hiddenName,
                          nsSeparator: '|',
                        })
                      : t('Call {{step}} of {{count}} on @{{name}}', {
                          step: step.step,
                          count: GRACE_EPOCHS + 1,
                          name: hiddenName,
                        }),
                  }
                )
              }
            >
              {t('Challenge @{{name}}', {name: hiddenName})}
            </Action>
            <SmallText>
              {step.canCall
                ? t('Next: call {{step}} of {{count}}', {
                    step: step.step,
                    count: GRACE_EPOCHS + 1,
                    nsSeparator: '|',
                  })
                : t(
                    'Called in this epoch: call {{step}} of {{count}} from the next one',
                    {
                      step: step.step,
                      count: GRACE_EPOCHS + 1,
                      nsSeparator: '|',
                    }
                  )}
            </SmallText>
          </HStack>
          {!mayClaim && (
            <SmallText>
              {t('Only a validated or vouched account can take a name.')}
            </SmallText>
          )}
        </Stack>
      )}
    </Stack>
  )
}

/**
 * On the account's own profile: the vouches offered to it (Accept, Decline) and its voucher (End). The members it
 * vouches for are on its Members page (MyMembers).
 */
export function MyVouching({profile}) {
  const {t} = useTranslation()
  const {me, names, sending} = useSocial()
  const {data: offers} = useOffersTo(me)
  if (!profilesEnabled || !me) return null
  const isMember = isActingMember(profile)
  return (
    <Stack spacing={1}>
      {profile?.voucher && (
        <HStack spacing={2}>
          <Text>
            {t('Vouched for by {{name}}', {
              name: displayName(profile.voucher, names),
            })}
            {!isMember && ` ${t('(not active now)')}`}
          </Text>
          <Action
            call={ProfileCall.endVouch()}
            onClick={() =>
              sending.prepareProfile('endVouch', () => ProfileCall.endVouch())
            }
          >
            {t('End the vouch')}
          </Action>
        </HStack>
      )}
      {isMember && (
        <SmallText>
          {t(
            'As a vouched member, a name, a profile or a Trust costs about one more fee, burned.'
          )}
        </SmallText>
      )}
      {(offers || []).map(({voucher}) => (
        <HStack key={voucher} spacing={2} flexWrap="wrap">
          <Text>
            {t('{{name}} offers to vouch for you.', {
              name: displayName(voucher, names),
            })}
          </Text>
          <Action
            call={ProfileCall.acceptVouch(voucher)}
            onClick={() =>
              sending.prepareProfile(
                'acceptVouch',
                () => ProfileCall.acceptVouch(voucher),
                {
                  detail: t(
                    'You may then hold a name, write a profile and give Trust while {{name}} is validated',
                    {name: displayName(voucher, names)}
                  ),
                }
              )
            }
          >
            {t('Accept')}
          </Action>
          <Action
            call={ProfileCall.declineOffer(voucher)}
            onClick={() =>
              sending.prepareProfile('declineOffer', () =>
                ProfileCall.declineOffer(voucher)
              )
            }
          >
            {t('Decline')}
          </Action>
        </HStack>
      ))}
    </Stack>
  )
}

/**
 * In Notifications, above the activity: a vouch offered to the account and waiting for its answer, with Accept and
 * Decline; a click on the voucher opens its profile.
 */
export function OfferReceivedCard({voucher, onProfile}) {
  const {t} = useTranslation()
  const {names, sending} = useSocial()
  const name = displayName(voucher, names)
  return (
    <HStack
      spacing={3}
      align="flex-start"
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
    >
      <PersonAvatar
        address={voucher}
        boxSize={10}
        rounded="md"
        cursor="pointer"
        onClick={() => onProfile(voucher)}
      />
      <Stack spacing={1} flex={1} minW={0}>
        <Text
          as="button"
          textAlign="left"
          fontWeight={500}
          onClick={() => onProfile(voucher)}
        >
          {t('{{name}} offers to vouch for you.', {name})}
        </Text>
        <SmallText>
          {t(
            'Once you accept, you may hold a name, write a profile and give Trust while they are validated.'
          )}
        </SmallText>
        <HStack spacing={2}>
          <Action
            call={ProfileCall.acceptVouch(voucher)}
            onClick={() =>
              sending.prepareProfile(
                'acceptVouch',
                () => ProfileCall.acceptVouch(voucher),
                {
                  detail: t(
                    'You may then hold a name, write a profile and give Trust while {{name}} is validated',
                    {name}
                  ),
                }
              )
            }
          >
            {t('Accept')}
          </Action>
          <Action
            call={ProfileCall.declineOffer(voucher)}
            onClick={() =>
              sending.prepareProfile('declineOffer', () =>
                ProfileCall.declineOffer(voucher)
              )
            }
          >
            {t('Decline')}
          </Action>
        </HStack>
      </Stack>
    </HStack>
  )
}
