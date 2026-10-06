/* eslint-disable react/prop-types */
import React from 'react'
import Head from 'next/head'
import {ChakraProvider, extendTheme} from '@chakra-ui/react'
import '../i18n'
import {QueryClientProvider} from 'react-query'
import {theme} from '../shared/theme'
import {NodeProvider} from '../shared/providers/node-context'
import {SettingsProvider} from '../shared/providers/settings-context'
import {AutoUpdateProvider} from '../shared/providers/update-context'
import {ChainProvider} from '../shared/providers/chain-context'
import {TimingProvider} from '../shared/providers/timing-context'
import {EpochProvider} from '../shared/providers/epoch-context'
import {IdentityProvider} from '../shared/providers/identity-context'
import {VotingNotificationProvider} from '../shared/providers/voting-notification-context'
import {OnboardingProvider} from '../shared/providers/onboarding-context'
import {DnaLinkProvider} from '../screens/dna/hooks'
import {ConfirmQuit} from '../shared/components/confirm-quit'
import {queryClient} from '../shared/utils/utils'

export default function App({Component, ...pageProps}) {
  const [isMounted, setIsMounted] = React.useState(false)

  React.useEffect(() => {
    setIsMounted(true)
  }, [])

  React.useEffect(() => {
    if (!isMounted) return undefined

    document.documentElement.dataset.idenaRendererReady = 'true'
    return () => {
      delete document.documentElement.dataset.idenaRendererReady
    }
  }, [isMounted])

  return (
    <>
      <Head>
        <link href="/static/scrollbars.css" rel="stylesheet" />
      </Head>

      {isMounted ? (
        <ChakraProvider theme={extendTheme(theme)}>
          <AppProviders>
            <Component {...pageProps} />
            <ConfirmQuit />
          </AppProviders>
        </ChakraProvider>
      ) : null}
    </>
  )
}

function AppProviders(props) {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AutoUpdateProvider>
          <NodeProvider>
            <ChainProvider>
              <TimingProvider>
                <EpochProvider>
                  <IdentityProvider>
                    <OnboardingProvider>
                      <DnaLinkProvider>
                        <VotingNotificationProvider {...props} />
                      </DnaLinkProvider>
                    </OnboardingProvider>
                  </IdentityProvider>
                </EpochProvider>
              </TimingProvider>
            </ChainProvider>
          </NodeProvider>
        </AutoUpdateProvider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}
