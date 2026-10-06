/* eslint-disable react/prop-types */
import React from 'react'
import {Button, HStack, Skeleton, Stack, Text} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import Layout from '../shared/components/layout'
import {
  Avatar,
  Page,
  PageTitle,
  SmallText,
  TextLink,
} from '../shared/components/components'
import {FillPlaceholder} from '../screens/oracles/components'
import {useChainState} from '../shared/providers/chain-context'
import {useIdentityState} from '../shared/providers/identity-context'
import {isAddress} from '../shared/utils/utils'
import {useIdentityHistory} from '../screens/history/hooks'
import {HistoryTab, parseHistoryTab} from '../screens/history/utils'
import {
  CeremoniesTab,
  MiningTab,
  TransactionsTab,
} from '../screens/history/components'

function HistoryTabContent({tab, address, isOwn, history, isError, error}) {
  const {t} = useTranslation()
  if (tab === HistoryTab.Transactions)
    return <TransactionsTab address={address} isOwn={isOwn} />
  if (isError)
    return (
      <FillPlaceholder py={12}>
        {t('Your node did not answer the history request.')} {error?.message}
      </FillPlaceholder>
    )
  if (!history)
    return (
      <Stack spacing={2}>
        <Skeleton h={8} />
        <Skeleton h={8} />
        <Skeleton h={8} />
      </Stack>
    )
  if (tab === HistoryTab.Mining)
    return <MiningTab history={history} isOwn={isOwn} />
  return <CeremoniesTab history={history} isOwn={isOwn} />
}

// The History page: ceremonies, transactions and mining of the user's address (or ?address=), from the own node.
export default function HistoryPage() {
  const {t} = useTranslation()
  const router = useRouter()
  const {syncing, offline} = useChainState()
  const {address: ownAddress} = useIdentityState()

  const queryAddress = router.query.address
  const address = isAddress(queryAddress) ? queryAddress : ownAddress
  const isOwn = address?.toLowerCase() === ownAddress?.toLowerCase()
  const tab = parseHistoryTab(router.query.tab)

  const {
    data: history,
    isError,
    error,
  } = useIdentityHistory(address, {
    enabled: !offline,
  })

  const selectTab = (value) =>
    router.replace(
      {pathname: '/history', query: {...router.query, tab: value}},
      undefined,
      {shallow: true}
    )

  return (
    <Layout syncing={syncing} offline={offline}>
      <Page>
        <PageTitle>{t('History')}</PageTitle>
        <Stack spacing={6} w="full">
          {address && (
            <HStack spacing={3}>
              <Avatar address={address} boxSize={10} />
              <Stack spacing={0}>
                <Text fontFamily="mono" fontSize="sm">
                  {address}
                </Text>
                {isOwn ? (
                  <SmallText>{t('Your address')}</SmallText>
                ) : (
                  <TextLink href="/history" fontSize="sm">
                    {t('Back to your history')}
                  </TextLink>
                )}
              </Stack>
            </HStack>
          )}
          <HStack>
            <Button
              variant="tab"
              isActive={tab === HistoryTab.Ceremonies}
              onClick={() => selectTab(HistoryTab.Ceremonies)}
            >
              {t('Ceremonies')}
            </Button>
            <Button
              variant="tab"
              isActive={tab === HistoryTab.Transactions}
              onClick={() => selectTab(HistoryTab.Transactions)}
            >
              {t('Transactions')}
            </Button>
            <Button
              variant="tab"
              isActive={tab === HistoryTab.Mining}
              onClick={() => selectTab(HistoryTab.Mining)}
            >
              {t('Mining')}
            </Button>
          </HStack>
          <HistoryTabContent
            tab={tab}
            address={address}
            isOwn={isOwn}
            history={history}
            isError={isError}
            error={error}
          />
        </Stack>
      </Page>
    </Layout>
  )
}
