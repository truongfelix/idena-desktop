import React from 'react'
import {Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  Dialog,
  DialogBody,
  DialogFooter,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {callRpc} from '../../shared/utils/utils'
import {useCoinbase, useTrackTx} from './hooks'
import {planAdRemoval, sendAdRemoval} from './remove-ad'

const nodeCall = (method, params) => callRpc(method, ...params)

/**
 * Confirms taking the campaign `ad` out of the profile, with its fee, and sends it; `onDone(ad)` once the profile
 * change is mined.
 */
// eslint-disable-next-line react/prop-types
export function RemoveAdDialog({ad, isOpen, onClose, onDone, onError}) {
  const {t} = useTranslation()

  const coinbase = useCoinbase()

  const [plan, setPlan] = React.useState(null)
  const [problem, setProblem] = React.useState(null)
  const [hash, setHash] = React.useState(null)

  React.useEffect(() => {
    setPlan(null)
    setProblem(null)
    setHash(null)
    if (!isOpen || !ad || !coinbase) return
    let current = true
    planAdRemoval(nodeCall, coinbase, ad)
      .then((planned) => current && setPlan(planned))
      .catch((error) => current && setProblem(error?.message))
    return () => {
      current = false
    }
  }, [ad, coinbase, isOpen])

  useTrackTx(hash, {
    onMined: () => {
      onDone?.(ad)
      onClose()
    },
    onError,
  })

  const sending = Boolean(hash)

  return (
    <Dialog
      title={t('Remove from your profile?')}
      isOpen={isOpen}
      onClose={sending ? () => {} : onClose}
    >
      <DialogBody>
        <Stack spacing={3}>
          <Text>
            {t(
              'The campaign leaves your profile: no app shows it any more. The iDNA already burned for it stays burned.',
              {nsSeparator: '!!'}
            )}
          </Text>
          {problem && <Text color="red.500">{problem}</Text>}
          {!problem && (
            <Text color="muted">
              {plan
                ? t('Network fee: {{fee}} iDNA', {
                    fee: plan.fee,
                    nsSeparator: '!!',
                  })
                : t('Estimating the network fee…')}
            </Text>
          )}
          {sending && (
            <Text color="muted">
              {t('Waiting for the transaction to be mined…')}
            </Text>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton isDisabled={sending} onClick={onClose}>
          {t('Cancel')}
        </SecondaryButton>
        <PrimaryButton
          colorScheme="red"
          isDisabled={!plan || sending}
          isLoading={sending}
          onClick={async () => {
            try {
              setHash(await sendAdRemoval(nodeCall, plan))
            } catch (error) {
              setProblem(error?.message)
            }
          }}
        >
          {t('Remove')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
