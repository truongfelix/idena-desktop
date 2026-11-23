/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {HStack, Stack, Text, Textarea} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {MAX_REASON_BYTES} from '../moderation'
import {
  ModerationCall,
  ownReport,
  reasonBytes,
  reportRefusal,
} from '../moderation-calls'
import {Chip} from './chips'

/**
 * The reasons offered first, as the Idena Social website's: written to the chain in English, whatever the app's
 * language (moderators and the website read them), shown translated.
 */
function useReasons() {
  const {t} = useTranslation()
  return [
    ['Spam', t('Spam')],
    ['Scam or phishing', t('Scam or phishing')],
    ['Illegal', t('Illegal')],
    ['Harassment', t('Harassment')],
  ]
}

/** Why a report or a moderator action cannot be sent, by the key moderation-calls.js gives. */
export function useRefusalText() {
  const {t} = useTranslation()
  return (key) =>
    ({
      noAccount: t('No account: the node has no key.', {nsSeparator: '|'}),
      banned: t('Your account is banned by the community moderators.'),
      self: t('Not your own account.'),
      alreadyBanned: t('This account is already banned.'),
      noReason: t('Give a reason.'),
      tooLong: t('The reason is too long.'),
      notModerator: t('Only community moderators can do this.'),
      targetStaker: t("Stakers can't be banned."),
      targetVouched: t(
        "Moderators can't be banned: a staker must revoke their vouches first.",
        {nsSeparator: '|'}
      ),
      epochs: t("The ban's length: a number of epochs, at most 65,535.", {
        nsSeparator: '|',
      }),
      batch: t('Too many posts at once.'),
      notStaker: t('Only identities with 1,000,000 iDNA staked can do this.'),
      vouchLimit: t('You already vouch for 5 moderators.'),
    }[key] || key)
}

/** A reason: a chip among REPORT_REASONS (or Other) and, for Other or to add to it, a text; its byte count. */
export function ReasonField({reason, setReason, required}) {
  const {t} = useTranslation()
  const reasons = useReasons()
  const other = t('Other')
  const [chosen, setChosen] = React.useState(null)
  const bytes = reasonBytes(reason)
  return (
    <Stack spacing={2}>
      <HStack spacing={2} flexWrap="wrap" rowGap={2}>
        {[...reasons, [null, other]].map(([value, label]) => (
          <Chip
            key={label}
            isSelected={chosen === label}
            onClick={() => {
              setChosen(label)
              setReason(value ?? '')
            }}
          >
            {label}
          </Chip>
        ))}
      </HStack>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          required ? t('Why? (required)') : t('Why? (optional, public)')
        }
        rows={2}
      />
      <SmallText color={bytes > MAX_REASON_BYTES ? 'red.500' : undefined}>
        {t('{{bytes}} / {{max}} bytes', {bytes, max: MAX_REASON_BYTES})}
      </SmallText>
    </Stack>
  )
}

/**
 * Reports a post (`hash`, by `author`) or an account (`address`) to the community moderators: a public reason, sent
 * as a transaction (its fee shown next). A report made before shows instead: once is enough.
 */
export function ReportDialog({
  hash = null,
  author = null,
  address = null,
  onClose,
}) {
  const {t} = useTranslation()
  const {me, names, moderation, epoch, sending} = useSocial()
  const refusalText = useRefusalText()
  const [reason, setReason] = React.useState('')
  const epochNumber = epoch?.epoch ?? null
  const target = hash || address
  const name = displayName(address || author, names)
  const previous = me ? ownReport(moderation.state, me, target) : null
  const refusal = reportRefusal(moderation.state, epochNumber, me, {
    address,
    reason,
  })
  const call = hash
    ? ModerationCall.reportPost(hash, reason.trim())
    : ModerationCall.report(address, reason.trim())
  // One report per target waits at a time, whatever its reason.
  const inFlight = sending.inFlight.some(
    (item) =>
      item.key.startsWith(`${call.contract.toLowerCase()}:${call.method}:`) &&
      item.key.includes(String(target).toLowerCase())
  )
  return (
    <Dialog
      title={
        hash
          ? t('Report a post by {{name}}', {name})
          : t('Report {{name}}', {name})
      }
      isOpen
      onClose={onClose}
      size="md"
    >
      <DialogBody>
        <Stack spacing={3}>
          {previous ? (
            <Text>
              {t('You reported this on {{date}}: {{reason}}', {
                date: new Date(previous.time * 1000).toLocaleDateString(),
                reason: previous.reason,
                nsSeparator: '|',
              })}
            </Text>
          ) : (
            <>
              <ReasonField reason={reason} setReason={setReason} required />
              <SmallText>
                {t(
                  'Reports are public on the blockchain: anyone can see your address and this reason. A report bans nothing: the community moderators read it.',
                  {nsSeparator: '|'}
                )}
              </SmallText>
              {refusal && refusal !== 'noReason' && (
                <SmallText color="red.500">{refusalText(refusal)}</SmallText>
              )}
              {inFlight && (
                <SmallText>
                  {t('A report on this waits for its block.')}
                </SmallText>
              )}
            </>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        {!previous && (
          <PrimaryButton
            isDisabled={Boolean(refusal) || inFlight || !sending.canAct}
            onClick={() => {
              sending.prepareModeration(hash ? 'reportPost' : 'report', call, {
                detail: reason.trim(),
              })
              onClose()
            }}
          >
            {t('Report')}
          </PrimaryButton>
        )}
      </DialogFooter>
    </Dialog>
  )
}
