/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Flex,
  Stack,
  Switch,
  Text,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import SettingsLayout from '../../screens/settings/layout'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../../shared/providers/settings-context'
import {archiveFlips} from '../../screens/flips/utils'
import {
  SettingsSection,
  DevSettingsSection,
  SettingsLinkButton,
} from '../../screens/settings/components'
import {
  FormLabel,
  HDivider,
  Toast,
  Tooltip,
  VDivider,
} from '../../shared/components/components'
import {
  ExportPrivateKeyDialog,
  ImportPrivateKeyDialog,
  LocaleSwitcher,
} from '../../screens/settings/containers'
import {PrivateKeyIcon} from '../../shared/components/icons'
import {useReleaseCheckText} from '../../shared/components/release-check'

const {clear: clearFlips} = global.flipStore || {}
const inviteDb = global.invitesDb || {}

function Settings() {
  const {t} = useTranslation()

  const toast = useToast()

  const showSuccessToast = (title) =>
    toast({
      // eslint-disable-next-line react/display-name
      render: () => <Toast title={title} />,
    })

  const {runInternalNode, useExternalNode, imageSearch, releaseCheck} =
    useSettingsState()
  const {setImageSearch, setReleaseCheck} = useSettingsDispatch()
  const releaseCheckText = useReleaseCheckText()

  const {
    isOpen: isOpenExportPk,
    onOpen: onOpenExportPk,
    onClose: onCloseExportPk,
  } = useDisclosure()

  const {
    isOpen: isOpenImportPk,
    onOpen: onOpenImportPk,
    onClose: onCloseImportPk,
  } = useDisclosure()

  return (
    <SettingsLayout>
      <Stack spacing={10} mt={8}>
        <SettingsSection title={t('Interface')}>
          <Flex align="center">
            <FormLabel color="muted" fontWeight="normal" w={32}>
              {t('Language')}
            </FormLabel>
            <LocaleSwitcher />
          </Flex>
        </SettingsSection>

        <SettingsSection title={t('Flips')}>
          <Stack isInline spacing={3} align="center">
            <Box>
              <Switch
                isChecked={imageSearch === true}
                onChange={(e) => setImageSearch(e.target.checked)}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>{t('Search pictures on the web')}</Text>
              <Text color="muted">
                {t(
                  'The search sends your words to Openverse and Wikimedia from this computer, so they see its internet address and the words searched.'
                )}
              </Text>
            </Box>
          </Stack>
        </SettingsSection>

        <SettingsSection title={t('Updates')}>
          <Stack isInline spacing={3} align="center">
            <Box>
              <Switch
                isChecked={releaseCheck === true}
                onChange={(e) => setReleaseCheck(e.target.checked)}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>{t('Tell me of new versions')}</Text>
              <Text color="muted">{releaseCheckText}</Text>
            </Box>
          </Stack>
        </SettingsSection>

        <SettingsSection title={t('Private key')}>
          <HDivider />
          <Flex justify="space-between" align="center" py={6}>
            <Stack isInline spacing={3} align="center">
              <PrivateKeyIcon boxSize="5" />
              <Text fontSize="mdx" fontWeight={500}>
                {t('My private key')}
              </Text>
            </Stack>
            <Stack isInline align="center">
              <Flex align="center">
                {runInternalNode && !useExternalNode ? (
                  <SettingsLinkButton onClick={onOpenImportPk}>
                    {t('Import')}
                  </SettingsLinkButton>
                ) : (
                  <Tooltip
                    label={
                      useExternalNode
                        ? t('Import is not available for the external node')
                        : t(
                            'The built-in node is off. Turn on Run built-in node in Settings > Node to import a key.'
                          )
                    }
                    placement="top"
                    shouldWrapChildren
                  >
                    <SettingsLinkButton as={Box} d="flex" isDisabled>
                      {t('Import')}
                    </SettingsLinkButton>
                  </Tooltip>
                )}
              </Flex>
              <VDivider h={3} />
              <SettingsLinkButton onClick={onOpenExportPk}>
                {t('Export')}
              </SettingsLinkButton>
            </Stack>
          </Flex>
          <HDivider />
        </SettingsSection>

        <DevSettingsSection title={t('Flips')}>
          <Stack spacing={2}>
            <Box>
              <SettingsLinkButton
                onClick={() => {
                  clearFlips()
                  showSuccessToast(t('Flips deleted'))
                }}
              >
                {t('Clear flips')}
              </SettingsLinkButton>
            </Box>
            <Box>
              <SettingsLinkButton
                onClick={() => {
                  archiveFlips()
                  showSuccessToast(t('Flips archived'))
                }}
              >
                {t('Archive flips')}
              </SettingsLinkButton>
            </Box>
          </Stack>
        </DevSettingsSection>

        <DevSettingsSection title={t('Invites')}>
          <Box my={4}>
            <SettingsLinkButton
              onClick={() => {
                inviteDb.clearInvites()
                showSuccessToast(t('Invites removed'))
              }}
            >
              {t('Clear invites')}
            </SettingsLinkButton>
          </Box>
        </DevSettingsSection>
      </Stack>

      <ExportPrivateKeyDialog
        isOpen={isOpenExportPk}
        onClose={onCloseExportPk}
      />

      <ImportPrivateKeyDialog
        isOpen={isOpenImportPk}
        onClose={onCloseImportPk}
      />
    </SettingsLayout>
  )
}

export default Settings
