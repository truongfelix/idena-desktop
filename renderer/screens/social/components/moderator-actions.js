/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {HStack, Input, Stack, Text} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {useSocialIdentity} from '../hooks'
import {displayName} from '../people'
import {MODERATOR_STAKE, activeBan, vouchersOf} from '../moderation'
import {
  ModerationCall,
  canVouchMore,
  moderatorRefusal,
  moderatorRole,
} from '../moderation-calls'
import {Chip} from './chips'
import {ReasonField, useRefusalText} from './moderation-dialogs'

// The community moderators' actions (B-308), as the Idena Social website's moderator's guide: ban and unban an
// account, hide and restore a post, vouch, withdraw a vouch, revoke a moderator's vouches. Each is a transaction of the
// moderation contract (sending.js, prepareModeration), checked here first (moderation-calls.js) and by the node's dry
// run.

/** The account's moderator role ('staker', 'vouched' or null) with the state and the epoch; none while it is off. */
export function useModerator() {
  const {me, communityModeration, moderation, epoch} = useSocial()
  const {data: identity} = useSocialIdentity(communityModeration ? me : null)
  const epochNumber = epoch?.epoch ?? null
  const role = communityModeration
    ? moderatorRole(
        moderation.state,
        epochNumber,
        me,
        identity?.stake,
        MODERATOR_STAKE
      )
    : null
  return {role, me, state: moderation.state, epoch: epochNumber}
}

/** The role of `address` itself (a staker or a vouched moderator cannot be banned), from its live stake. */
export function useTargetRole(address) {
  const {moderation} = useSocial()
  const {data: identity, isLoading} = useSocialIdentity(address)
  if (!address) return {role: null, loading: false}
  if (Number(identity?.stake || 0) >= MODERATOR_STAKE)
    return {role: 'staker', loading: false}
  if (vouchersOf(moderation.state, address).length > 0)
    return {role: 'vouched', loading: false}
  return {role: null, loading: isLoading}
}

/** The ban lengths offered: a number of epochs, 0 for a permanent ban. */
const BAN_EPOCHS = [1, 4, 12, 0]

/**
 * One moderator action, confirmed with its reason (optional, public): `action` is a kind of sending.js's
 * MODERATION_KINDS but reports ('ban', 'unban', 'hidePost', 'restorePost', 'hidePosts', 'modVouch', 'withdrawVouch',
 * 'revokeVouches'), on `address`, a post's `hash`, or `hashes`.
 */
export function ModeratorDialog({
  action,
  address = null,
  hash = null,
  hashes = null,
  onClose,
}) {
  const {t} = useTranslation()
  const {names, sending} = useSocial()
  const {role, me, state, epoch} = useModerator()
  const target = useTargetRole(action === 'ban' ? address : null)
  const refusalText = useRefusalText()
  const [reason, setReason] = React.useState('')
  const [epochs, setEpochs] = React.useState(1)
  const name = address ? displayName(address, names) : ''
  const withReason = ['ban', 'unban', 'hidePost', 'restorePost', 'hidePosts']
  const needsStake = ['modVouch', 'revokeVouches'].includes(action)
  let refusal = moderatorRefusal(state, epoch, me, role, {
    address,
    targetRole: action === 'ban' ? target.role : null,
    epochs,
    reason,
    count: hashes ? hashes.length : 1,
  })
  if (action === 'withdrawVouch') refusal = me ? null : 'noAccount'
  else if (!refusal && needsStake && role !== 'staker') refusal = 'notStaker'
  else if (!refusal && action === 'modVouch') {
    if (activeBan(state, address, epoch)) refusal = 'alreadyBanned'
    else if (!canVouchMore(state, me)) refusal = 'vouchLimit'
  }
  const titles = {
    ban: t('Ban {{name}}', {name}),
    unban: t('Unban {{name}}', {name}),
    hidePost: t('Hide this post'),
    restorePost: t('Restore this post'),
    hidePosts: t('Hide {{count}} posts', {count: hashes?.length || 0}),
    modVouch: t('Vouch for {{name}} as moderator', {name}),
    withdrawVouch: t('Withdraw your vouch for {{name}}', {name}),
    revokeVouches: t('Revoke the moderator status of {{name}}', {name}),
  }
  const notes = {
    ban: t(
      'Their posts made during the ban are not shown; older ones show as a line while answers under them are shown. Any moderator can unban.',
      {nsSeparator: '|'}
    ),
    hidePost: t(
      'It stays hidden until a moderator restores it, even if its author is never banned.'
    ),
    hidePosts: t(
      'Each stays hidden until a moderator restores it. Posts hidden already are skipped.'
    ),
    modVouch: t(
      'They can then ban and hide, as long as one vouch for them remains. You can have 5 vouches at a time.',
      {nsSeparator: '|'}
    ),
    revokeVouches: t(
      'Every vouch for them ends, whoever made it: they are no moderator then, and can be banned.',
      {nsSeparator: '|'}
    ),
  }
  const calls = {
    ban: () => ModerationCall.ban(address, epochs, reason.trim()),
    unban: () => ModerationCall.unban(address, reason.trim()),
    hidePost: () => ModerationCall.hidePost(hash, reason.trim()),
    restorePost: () => ModerationCall.restorePost(hash, reason.trim()),
    hidePosts: () => ModerationCall.hidePosts(hashes, reason.trim()),
    modVouch: () => ModerationCall.vouch(address),
    withdrawVouch: () => ModerationCall.withdrawVouch(address),
    revokeVouches: () => ModerationCall.revokeVouches(address),
  }
  const call = calls[action]()
  const inFlight = sending.isInFlight(call)
  return (
    <Dialog title={titles[action]} isOpen onClose={onClose} size="md">
      <DialogBody>
        <Stack spacing={3}>
          {notes[action] && <Text>{notes[action]}</Text>}
          {action === 'ban' && (
            <Stack spacing={2}>
              <HStack spacing={2} flexWrap="wrap" rowGap={2}>
                {BAN_EPOCHS.map((value) => (
                  <Chip
                    key={value}
                    isSelected={epochs === value}
                    onClick={() => setEpochs(value)}
                  >
                    {value === 0
                      ? t('Permanently')
                      : t('{{count}} epochs', {count: value})}
                  </Chip>
                ))}
                <Input
                  w="7rem"
                  size="sm"
                  type="number"
                  min={0}
                  value={epochs}
                  onChange={(e) => setEpochs(Number(e.target.value))}
                />
              </HStack>
              <SmallText>
                {epochs === 0
                  ? t('Until a moderator unbans them.')
                  : t('It ends by itself after {{count}} validations.', {
                      count: epochs,
                    })}
              </SmallText>
            </Stack>
          )}
          {withReason.includes(action) && (
            <ReasonField
              reason={reason}
              setReason={setReason}
              required={false}
            />
          )}
          <SmallText>
            {t(
              'A transaction of the moderation contract: public on the blockchain, with your address. Its fee shows next.',
              {nsSeparator: '|'}
            )}
          </SmallText>
          {refusal && (
            <SmallText color="red.500">{refusalText(refusal)}</SmallText>
          )}
          {inFlight && <SmallText>{t('It waits for its block.')}</SmallText>}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          isDisabled={
            Boolean(refusal) || target.loading || inFlight || !sending.canAct
          }
          onClick={() => {
            sending.prepareModeration(action, call, {
              detail: reason.trim() || null,
            })
            onClose()
          }}
        >
          {t('Continue')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Moderate, on another account's profile, for a moderator: its ban (with who made it), whether it is a staker or a
 * vouched moderator (and who vouches for it), the reports on it; Ban or Unban, and for a staker Vouch as moderator,
 * Withdraw the vouch and Revoke moderator status.
 */
export function ModeratePanel({address}) {
  const {t} = useTranslation()
  const {names} = useSocial()
  const {role, me, state, epoch} = useModerator()
  const target = useTargetRole(address)
  const refusalText = useRefusalText()
  const [acting, setActing] = React.useState(null)
  if (!role || !address || address === me) return null
  const ban = activeBan(state, address, epoch)
  const vouchers = vouchersOf(state, address)
  const reporters = new Set(
    state.reports
      .filter((r) => r.kind === 'address' && r.target === address)
      .map((r) => r.reporter)
  )
  const iVouch = vouchers.includes(me)
  const lines = [
    target.role === 'staker' &&
      t('A staker: a moderator, never banned.', {nsSeparator: '|'}),
    vouchers.length > 0 &&
      t('A moderator, vouched for by {{names}}.', {
        names: vouchers.map((v) => displayName(v, names)).join(', '),
      }),
    reporters.size > 0 &&
      t('Reported by {{count}} accounts.', {count: reporters.size}),
  ].filter(Boolean)
  const act = (action) => setActing({action, address})
  return (
    <Stack
      spacing={2}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
    >
      <Text fontWeight={500}>{t('Moderate')}</Text>
      {lines.map((line) => (
        <SmallText key={line}>{line}</SmallText>
      ))}
      <HStack spacing={2} flexWrap="wrap" rowGap={2}>
        {ban ? (
          <SecondaryButton size="sm" onClick={() => act('unban')}>
            {t('Unban…')}
          </SecondaryButton>
        ) : (
          <SecondaryButton
            size="sm"
            isDisabled={Boolean(target.role)}
            title={
              target.role
                ? refusalText(
                    `target${target.role === 'staker' ? 'Staker' : 'Vouched'}`
                  )
                : undefined
            }
            onClick={() => act('ban')}
          >
            {t('Ban…')}
          </SecondaryButton>
        )}
        {role === 'staker' && !iVouch && !ban && target.role !== 'staker' && (
          <SecondaryButton size="sm" onClick={() => act('modVouch')}>
            {t('Vouch as moderator…')}
          </SecondaryButton>
        )}
        {iVouch && (
          <SecondaryButton size="sm" onClick={() => act('withdrawVouch')}>
            {t('Withdraw your vouch…')}
          </SecondaryButton>
        )}
        {role === 'staker' && vouchers.length > 0 && (
          <SecondaryButton size="sm" onClick={() => act('revokeVouches')}>
            {t('Revoke moderator status…')}
          </SecondaryButton>
        )}
      </HStack>
      {acting && (
        <ModeratorDialog {...acting} onClose={() => setActing(null)} />
      )}
    </Stack>
  )
}
