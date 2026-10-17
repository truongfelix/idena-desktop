/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {Dialog, DialogBody, DialogFooter} from './components'
import {PrimaryButton, SecondaryButton} from './button'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../providers/settings-context'

/**
 * A newer release (main/app-update-check.js) with its note; Download opens its page in the browser: the app
 * installs nothing by itself (ruling Q-35).
 */
export function ReleaseNoteDialog({release, isOpen, onClose, onDownload}) {
  const {t} = useTranslation()

  if (!release) return null

  return (
    <Dialog
      title={t('Idena {{version}} is ready', {version: release.version})}
      size="lg"
      scrollBehavior="inside"
      isOpen={isOpen}
      onClose={onClose}
    >
      <DialogBody>
        {release.notes ? (
          <Box
            as="pre"
            whiteSpace="pre-wrap"
            fontFamily="inherit"
            fontSize="sm"
            maxH="sm"
            overflowY="auto"
          >
            {release.notes}
          </Box>
        ) : (
          <Text color="muted">{t('This release has no note.')}</Text>
        )}
        <Text color="muted" mt={4}>
          {t(
            'Download opens the release page in your browser. Install the new version from there, as the first time.'
          )}
        </Text>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
        <PrimaryButton
          onClick={() => {
            onDownload()
            onClose()
          }}
        >
          {t('Download')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** What the question and the setting say is sent. */
export function useReleaseCheckText() {
  const {t} = useTranslation()
  return t(
    'Once a day the app asks GitHub for the new versions of Idena desktop, and shows a new one with its note. GitHub sees this computer’s internet address. Nothing is downloaded or installed by itself.'
  )
}

/** The question asked once (ruling Q-50): until it is answered, nothing goes to GitHub. */
export function ReleaseCheckQuestion() {
  const {t} = useTranslation()
  const {initialized, releaseCheck} = useSettingsState()
  const {setReleaseCheck} = useSettingsDispatch()
  const text = useReleaseCheckText()

  const isE2E = global.env?.NODE_ENV === 'e2e'
  const isOpen = Boolean(initialized) && releaseCheck === undefined && !isE2E

  return (
    <Dialog
      title={t('Tell you of new versions?')}
      isOpen={isOpen}
      onClose={() => setReleaseCheck(false)}
    >
      <DialogBody>
        <Text>{text}</Text>
        <Text color="muted" mt={2}>
          {t('You can change it in Settings › General.')}
        </Text>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={() => setReleaseCheck(false)}>
          {t('Not now')}
        </SecondaryButton>
        <PrimaryButton onClick={() => setReleaseCheck(true)}>
          {t('Turn on')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
