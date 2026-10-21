/* eslint-disable react/prop-types */
/* global BigInt */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Input, Stack, Text} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {socialRpc} from '../node'
import {shortAddress} from '../people'
import {fromWei, toWei, totalFee} from '../posting'
import {MUTED} from './theme'

/** The kinds written to the profiles contract. */
const PROFILE_TITLES = [
  'name',
  'dropName',
  'profile',
  'trust',
  'untrust',
  'challenge',
  'vouch',
  'acceptVouch',
  'declineOffer',
  'cancelOffer',
  'endVouch',
]

/** A fee as the phone app shows it: 2 places, rounded up. */
const fee = (wei) => fromWei(wei, 2, true)

const kilobytes = (bytes) => Math.ceil(bytes / 1000)

/**
 * The confirmation before anything is sent, as the phone app's: who signs, each file stored on IPFS with its fee,
 * the call's fee, and the total. Nothing leaves the computer before Send.
 */
export function ConfirmDialog({pending, onSend, onCancel}) {
  const {t} = useTranslation()
  const titles = {
    post: t('Post on idena.social'),
    reply: t('Reply on idena.social'),
    comment: t('Comment on idena.social'),
    like: t('Like on idena.social'),
    tip: t('Tip on idena.social'),
    message: t('Private message on idena.social'),
    groupKey: t('Group change'),
    groupNotice: t('Tell the people removed'),
    name: t('Your public name'),
    dropName: t('Drop your public name'),
    profile: t('Your public profile'),
    trust: t('Trust'),
    untrust: t('Take your Trust back'),
    challenge: t('Challenge a name'),
    vouch: t('Offer to vouch'),
    acceptVouch: t('Accept the vouch'),
    declineOffer: t('Decline the vouch'),
    cancelOffer: t('Withdraw your offer'),
    endVouch: t('End the vouch'),
    killInvitee: t('Terminate the invitation'),
  }
  const isProfile = PROFILE_TITLES.includes(pending.kind)
  const hasFiles = pending.files.length > 0
  return (
    <Dialog
      title={pending.title || titles[pending.kind]}
      isOpen
      onClose={onCancel}
    >
      <DialogBody>
        <Stack spacing={3}>
          <Text>
            {pending.detail && `${pending.detail}. `}
            {isProfile &&
              t(
                'It is public: anyone can read it, and every version stays in the blockchain history for good, signed by your identity {{address}}.',
                {address: shortAddress(pending.from), nsSeparator: '|'}
              )}
            {!isProfile &&
              pending.privacy === 'group' &&
              t(
                "Only the group's members can read it. That you sent it, when and its size are public and stay on the blockchain for good, signed by your identity {{address}}; a change of the group also shows how many members get its key.",
                {address: shortAddress(pending.from)}
              )}
            {!isProfile &&
            pending.privacy !== 'group' &&
            pending.kind === 'message'
              ? t(
                  'Only the people in the conversation can read it. That you sent a message, when, its size and how many people it goes to are public and stay on the blockchain for good, signed by your identity {{address}}.',
                  {address: shortAddress(pending.from)}
                )
              : !isProfile &&
                pending.privacy !== 'group' &&
                t(
                  'It is public and stays on the blockchain for good, signed by your identity {{address}}.',
                  {address: shortAddress(pending.from)}
                )}
          </Text>
          {pending.files.map((file) => {
            if (file.stored)
              return (
                <Text key={file.what}>
                  {file.what === 'text'
                    ? t('The text is already stored on IPFS: no new fee.', {
                        nsSeparator: '|',
                      })
                    : t('The image is already stored on IPFS: no new fee.', {
                        nsSeparator: '|',
                      })}
                </Text>
              )
            const values = {
              size: kilobytes(file.bytes.length),
              fee: fee(file.fee),
              most: fee(file.fee * BigInt(2)),
            }
            return (
              <Text key={file.what}>
                {file.what === 'text'
                  ? t(
                      'Storing the text on IPFS ({{size}} KB): about {{fee}} iDNA (at most {{most}}).',
                      {...values, nsSeparator: '|'}
                    )
                  : t(
                      'Storing the image on IPFS ({{size}} KB): about {{fee}} iDNA (at most {{most}}).',
                      {...values, nsSeparator: '|'}
                    )}
              </Text>
            )
          })}
          <Text fontWeight={500}>
            {hasFiles && isProfile
              ? t('The profile: about {{fee}} iDNA (at most {{most}}).', {
                  fee: fee(pending.fee.fee),
                  most: fee(pending.fee.maxFee),
                  nsSeparator: '|',
                })
              : hasFiles &&
                t('The post: about {{fee}} iDNA (at most {{most}}).', {
                  fee: fee(pending.fee.fee),
                  most: fee(pending.fee.maxFee),
                  nsSeparator: '|',
                })}
            {!hasFiles &&
              t('Fee: about {{fee}} iDNA (at most {{most}}).', {
                fee: fee(pending.fee.fee),
                most: fee(pending.fee.maxFee),
                nsSeparator: '|',
              })}
          </Text>
          {pending.memberExtra && (
            <Text>
              {pending.memberExtra.lapsed
                ? t(
                    'The contract still lists you as a vouched member: you also send {{amount}} iDNA, burned by the contract (about one more fee). Ending the vouch first avoids it.',
                    {amount: pending.memberExtra.amount, nsSeparator: '|'}
                  )
                : t(
                    'As a vouched member, you also send {{amount}} iDNA, burned by the contract (about one more fee).',
                    {amount: pending.memberExtra.amount}
                  )}
            </Text>
          )}
          {hasFiles && (
            <Text fontWeight={500}>
              {t('Total: about {{total}} iDNA.', {
                total: fee(totalFee(pending)),
                nsSeparator: '|',
              })}
            </Text>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onCancel}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton onClick={onSend}>{t('Send')}</PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** The tip's amount, as the phone app asks it: whole iDNA, with the balance shown. */
export function TipDialog({name, onClose, onNext}) {
  const {t} = useTranslation()
  const [amount, setAmount] = React.useState('1')
  const [balance, setBalance] = React.useState(null)
  React.useEffect(() => {
    let alive = true
    socialRpc('dna_getCoinbaseAddr')
      .then((address) => socialRpc('dna_getBalance', [address]))
      .then((result) => alive && setBalance(fromWei(toWei(result?.balance), 2)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const value = /^[0-9]{1,9}$/.test(amount) ? Number(amount) : 0
  return (
    <Dialog title={t('Tip {{name}}', {name})} isOpen onClose={onClose}>
      <DialogBody>
        <Stack spacing={3}>
          <Text color={MUTED}>
            {t(
              'The tip goes to the author of this post, through the idena.social contract. Whole iDNA only.'
            )}
          </Text>
          {balance !== null && (
            <SmallText>
              {t('Your balance: {{balance}} iDNA', {
                balance,
                nsSeparator: '|',
              })}
            </SmallText>
          )}
          <Input
            autoFocus
            value={amount}
            inputMode="numeric"
            aria-label={t('iDNA')}
            placeholder={t('iDNA')}
            onChange={(e) =>
              setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value > 0) onNext(value)
            }}
          />
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton isDisabled={value <= 0} onClick={() => onNext(value)}>
          {t('Next')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
