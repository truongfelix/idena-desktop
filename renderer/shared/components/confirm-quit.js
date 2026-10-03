/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Stack,
  useDisclosure,
} from '@chakra-ui/react'
import {PrimaryButton, SecondaryButton} from './button'
import {callRpc} from '../utils/utils'
import {useChainState} from '../providers/chain-context'
import {useSettingsState} from '../providers/settings-context'
import {useFailToast} from '../hooks/use-toast'

const sendConfirmQuit = () => global.ipcRenderer.send('confirm-quit')

/**
 * Answers the main process's quit request on every page (it was only in Layout, so Quit did nothing on the
 * validation pages): quits at once, unless the built-in node mines, then asks first.
 */
export function ConfirmQuit() {
  const {loading, offline, syncing} = useChainState()
  const {runInternalNode} = useSettingsState()
  const {onOpen, ...disclosure} = useDisclosure()
  const failToast = useFailToast()

  const isReady = !loading && !offline && !syncing

  React.useEffect(() => {
    const handleRequestQuit = async () => {
      if (isReady && runInternalNode) {
        try {
          const {online} = await callRpc('dna_identity')
          if (online) {
            onOpen()
            return
          }
        } catch {
          // The node does not answer: nothing to ask about.
        }
      }
      sendConfirmQuit()
    }

    return global.ipcRenderer.on('confirm-quit', handleRequestQuit)
  }, [isReady, onOpen, runInternalNode])

  return <ConfirmQuitDialog {...disclosure} onError={failToast} />
}

function ConfirmQuitDialog({onClose, onError, ...props}) {
  const {t} = useTranslation()

  const stopMiningAndQuitRef = React.useRef()

  return (
    <AlertDialog
      isCentered
      leastDestructiveRef={stopMiningAndQuitRef}
      onClose={onClose}
      {...props}
    >
      <AlertDialogOverlay bg="xblack.080" />
      <AlertDialogContent
        bg="white"
        color="brandGray.500"
        fontSize="md"
        p={8}
        pt={6}
        rounded="lg"
      >
        <AlertDialogHeader fontSize="lg" fontWeight={500} p={0} mb={4}>
          {t('Are you sure you want to exit?')}
        </AlertDialogHeader>

        <AlertDialogBody p={0} mb={8}>
          {t(`Your mining status is active. Closing the app may cause the mining
      penalty.`)}
        </AlertDialogBody>

        <AlertDialogFooter p={0}>
          <Stack isInline justify="flex-end">
            <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
            <SecondaryButton onClick={sendConfirmQuit}>
              {t('Exit')}
            </SecondaryButton>
            <PrimaryButton
              ref={stopMiningAndQuitRef}
              onClick={async () => {
                try {
                  await callRpc('dna_becomeOffline', {})
                  sendConfirmQuit()
                } catch (error) {
                  onError(error?.message)
                }
              }}
            >
              {t('Stop mining and exit')}
            </PrimaryButton>
          </Stack>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
