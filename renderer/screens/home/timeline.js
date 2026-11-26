/* eslint-disable react/prop-types */
import React from 'react'
import {Button, Heading, HStack, Skeleton, Stack, Text} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {useQuery} from 'react-query'
import {FillPlaceholder} from '../oracles/components'
import {TextLink} from '../../shared/components/components'
import {useChainState} from '../../shared/providers/chain-context'
import {callRpc, toLocaleDna} from '../../shared/utils/utils'
import {useIdentityHistory} from '../history/hooks'
import {HistoryTab, parseHistoryTab} from '../history/utils'
import {CeremoniesTab, MiningTab, StaleReadNote} from '../history/components'
import {UserInlineCard} from './components'

export function TimelineContent({
  tab,
  isOwn,
  history,
  isError,
  isSuccess,
  error,
}) {
  const {t} = useTranslation()
  // A failed refresh keeps the timeline already read (as Wallets keeps its list).
  if (isError && !history)
    return (
      <FillPlaceholder py={12}>
        {[t('The history could not be read from your node.'), error?.message]
          .filter(Boolean)
          .join(' ')}
      </FillPlaceholder>
    )
  // The node answered with no history at all: nothing to wait for (each tab's own empty text).
  if (!history && isSuccess)
    return (
      <FillPlaceholder py={12}>
        {tab === HistoryTab.Mining
          ? t(
              'No mining reward recorded yet. Your node records them from this version on, for the blocks it adds.'
            )
          : t(
              'No validation of this address in the ceremonies your node knows.'
            )}
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
  const content =
    tab === HistoryTab.Mining ? (
      <MiningTab history={history} isOwn={isOwn} />
    ) : (
      <CeremoniesTab history={history} isOwn={isOwn} />
    )
  if (!isError) return content
  // A failed refresh: the timeline already read stays, with a line saying it may be out of date (as on Wallets).
  return (
    <Stack spacing={4}>
      <StaleReadNote error={error} />
      {content}
    </Stack>
  )
}

/**
 * My Idena's timeline: the identity's ceremonies (results, rewards, penalties) and, for the own address, its mining
 * per epoch, from the own node (dna_identityHistory). The tab is in the address bar (?tab=mining).
 */
export function IdentityTimeline({address, isOwn}) {
  const {t} = useTranslation()
  const router = useRouter()
  const {offline} = useChainState()

  const tab = isOwn ? parseHistoryTab(router.query.tab) : HistoryTab.Ceremonies

  const {
    data: history,
    isError,
    isSuccess,
    error,
  } = useIdentityHistory(address, {enabled: !offline})

  const selectTab = (value) =>
    router.replace(
      {pathname: router.pathname, query: {...router.query, tab: value}},
      undefined,
      {shallow: true}
    )

  return (
    <Stack spacing={4} w="full">
      <HStack spacing={6}>
        <Heading as="h2" fontSize="lg" fontWeight={500}>
          {t('Timeline')}
        </Heading>
        {isOwn && (
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
              isActive={tab === HistoryTab.Mining}
              onClick={() => selectTab(HistoryTab.Mining)}
            >
              {t('Mining')}
            </Button>
          </HStack>
        )}
      </HStack>
      <TimelineContent
        tab={tab}
        isOwn={isOwn}
        history={history}
        isError={isError}
        isSuccess={isSuccess}
        error={error}
      />
    </Stack>
  )
}

/** The own balance, under the identity, with the way to Wallets (its sends, receipts and transactions). */
export function BalanceLine({balance}) {
  const {t, i18n} = useTranslation()
  const shown =
    balance === undefined || balance === null || Number.isNaN(Number(balance))
      ? '–'
      : toLocaleDna(i18n.language, {maximumFractionDigits: 4})(balance)
  return (
    <HStack spacing={2} fontSize="mdx">
      <Text color="muted">{t('Balance')}</Text>
      <Text fontWeight={500}>{shown}</Text>
      <TextLink href="/wallets" fontWeight={500}>
        {t('Wallets')}
      </TextLink>
    </HStack>
  )
}

/**
 * My Idena opened for another address (?address=, from a transaction's details): its picture, name, status and
 * ceremonies, read-only (no wallet, no actions; the node keeps no transactions or mining of another address).
 */
export function OtherIdentity({address}) {
  const {t} = useTranslation()
  const {data: identity, isError} = useQuery(
    ['dna_identity', [address]],
    () => callRpc('dna_identity', address),
    {enabled: Boolean(address), staleTime: 60 * 1000}
  )

  return (
    <Stack spacing={8} w="full">
      <Stack spacing={2}>
        {identity || isError ? (
          <UserInlineCard
            identity={{address, state: identity?.state}}
            minH={24}
          />
        ) : (
          <Skeleton h={24} />
        )}
        <TextLink href="/home" fontWeight={500}>
          {t('Back to your identity')}
        </TextLink>
      </Stack>
      <IdentityTimeline address={address} isOwn={false} />
    </Stack>
  )
}
