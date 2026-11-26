import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, HStack, Stack, Text} from '@chakra-ui/react'
import SettingsLayout from '../../screens/settings/layout'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {HDivider} from '../../shared/components/components'
import {useIdentityState} from '../../shared/providers/identity-context'
import {useFailToast, useSuccessToast} from '../../shared/hooks/use-toast'
import {
  CONNECTED_SITES_EVENT,
  disconnectMessage,
  forgetSite,
  loadConnectedSites,
  saveConnectedSites,
} from '../../screens/dna/connected-sites'
import {disconnect} from '../../screens/dna/utils'

// Idena Connect (B-318): the websites this computer signed in to with Idena, the latest first. Disconnect asks a
// site that gave a disconnect endpoint to end the account's sessions (signed by the account in use), then takes it
// off the list; Forget only takes it off the list (the website itself may keep the sign-in).
export default function ConnectSettings() {
  const {t, i18n} = useTranslation()
  const {address: me} = useIdentityState()
  const successToast = useSuccessToast()
  const failToast = useFailToast()
  const [sites, setSites] = React.useState(() => loadConnectedSites())
  const [disconnecting, setDisconnecting] = React.useState(null)
  // A sign-in confirmed while this page is open (its dialog is over the page) shows at once.
  React.useEffect(() => {
    const reload = () => setSites(loadConnectedSites())
    window.addEventListener(CONNECTED_SITES_EVENT, reload)
    return () => window.removeEventListener(CONNECTED_SITES_EVENT, reload)
  }, [])

  const forget = ({site, address}) =>
    saveConnectedSites(forgetSite(loadConnectedSites(), site, address))

  const disconnectFrom = async (entry) => {
    const key = `${entry.site}|${entry.address}`
    setDisconnecting(key)
    try {
      const time = Math.floor(Date.now() / 1000)
      await disconnect(entry.disconnectEndpoint, {
        address: entry.address,
        time,
        message: disconnectMessage(entry.site, time),
      })
      forget(entry)
      successToast(
        t('Disconnected from {{host}}', {host: new URL(entry.site).host})
      )
    } catch (error) {
      failToast({
        title: t('The website did not disconnect you'),
        description: error?.message,
      })
    } finally {
      setDisconnecting(null)
    }
  }

  return (
    <SettingsLayout>
      <Stack spacing={6} mt={8} maxW="2xl">
        <Stack spacing={1}>
          <Text fontSize="mdx" fontWeight={500}>
            {t('Websites you signed in to with Idena')}
          </Text>
          <Text color="muted">
            {t(
              'Kept on this computer only. Disconnect asks the website to end your sign-in, where it offers it; Forget only removes it from this list: the website may keep you signed in.',
              {nsSeparator: '|'}
            )}
          </Text>
        </Stack>
        <HDivider />
        {sites.length === 0 ? (
          <Text color="muted">
            {t(
              'No website yet. A website that offers Sign in with Idena shows here after you confirm its sign-in.'
            )}
          </Text>
        ) : (
          sites.map((entry) => (
            <HStack
              key={`${entry.site}|${entry.address}`}
              spacing={4}
              align="center"
            >
              <Box flex={1} minW={0}>
                <Text fontWeight={500}>{new URL(entry.site).host}</Text>
                {entry.website &&
                  entry.website !== new URL(entry.site).host && (
                    <Text fontSize="sm" color="muted">
                      {t('From the website {{website}}', {
                        website: entry.website,
                      })}
                    </Text>
                  )}
                <Text fontSize="sm" color="muted" wordBreak="break-all">
                  {entry.address}
                </Text>
                <Text fontSize="sm" color="muted">
                  {t(
                    'First sign-in {{first}} · last {{last}} · sign-ins: {{number}}',
                    {
                      first: new Date(entry.firstAt).toLocaleDateString(
                        i18n.language
                      ),
                      last: new Date(entry.lastAt).toLocaleString(
                        i18n.language
                      ),
                      number: entry.count,
                      nsSeparator: '|',
                    }
                  )}
                </Text>
              </Box>
              {entry.disconnectEndpoint && (
                <PrimaryButton
                  // The node signs for the account in use only.
                  isDisabled={entry.address !== me?.toLowerCase()}
                  isLoading={disconnecting === `${entry.site}|${entry.address}`}
                  onClick={() => disconnectFrom(entry)}
                >
                  {t('Disconnect')}
                </PrimaryButton>
              )}
              <SecondaryButton onClick={() => forget(entry)}>
                {t('Forget')}
              </SecondaryButton>
            </HStack>
          ))
        )}
      </Stack>
    </SettingsLayout>
  )
}
