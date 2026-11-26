import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, HStack, Stack, Text} from '@chakra-ui/react'
import SettingsLayout from '../../screens/settings/layout'
import {SecondaryButton} from '../../shared/components/button'
import {HDivider} from '../../shared/components/components'
import {
  CONNECTED_SITES_EVENT,
  forgetSite,
  loadConnectedSites,
  saveConnectedSites,
} from '../../screens/dna/connected-sites'

// Idena Connect (B-318): the websites this computer signed in to with Idena, the latest first; Forget takes one off
// the list (the website itself may keep the sign-in: no call tells it).
export default function ConnectSettings() {
  const {t, i18n} = useTranslation()
  const [sites, setSites] = React.useState(() => loadConnectedSites())
  // A sign-in confirmed while this page is open (its dialog is over the page) shows at once.
  React.useEffect(() => {
    const reload = () => setSites(loadConnectedSites())
    window.addEventListener(CONNECTED_SITES_EVENT, reload)
    return () => window.removeEventListener(CONNECTED_SITES_EVENT, reload)
  }, [])

  const forget = ({site, address}) =>
    saveConnectedSites(forgetSite(loadConnectedSites(), site, address))

  return (
    <SettingsLayout>
      <Stack spacing={6} mt={8} maxW="2xl">
        <Stack spacing={1}>
          <Text fontSize="mdx" fontWeight={500}>
            {t('Websites you signed in to with Idena')}
          </Text>
          <Text color="muted">
            {t(
              'Kept on this computer only. Forget removes a website from this list: the website itself may keep you signed in.',
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
