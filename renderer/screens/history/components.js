/* eslint-disable react/prop-types */
import React from 'react'
import {Box, Flex, HStack, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  Table,
  TableCol,
  TableHeaderCol,
  TableRow,
} from '../../shared/components/table'
import {SmallText, TextLink} from '../../shared/components/components'
import {FillPlaceholder, OutlineButton} from '../oracles/components'
import {mapToFriendlyStatus} from '../../shared/providers/identity-context'
import {toLocaleDna} from '../../shared/utils/utils'
import {useTransactionPages} from './hooks'
import {
  CeremonyResult,
  ceremonyRows,
  counterParty,
  miningRows,
  signedAmount,
  toNumber,
  txTypeName,
} from './utils'

const ROWS_STEP = 20

function useDna(maximumFractionDigits = 3) {
  const {i18n} = useTranslation()
  return toLocaleDna(i18n.language, {maximumFractionDigits})
}

// For table cells whose header names the unit (", iDNA").
function useAmount(maximumFractionDigits = 3) {
  const {i18n} = useTranslation()
  const formatter = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits,
  })
  return (value) => formatter.format(value)
}

function formatDate(time, language) {
  return time
    ? new Date(time * 1000).toLocaleDateString(language, {dateStyle: 'medium'})
    : '–'
}

function formatDateTime(time, language) {
  return new Date(time * 1000).toLocaleString(language, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function ShowMore({onClick}) {
  const {t} = useTranslation()
  return (
    <Flex justify="center" pt={2}>
      <OutlineButton onClick={onClick}>{t('Show more')}</OutlineButton>
    </Flex>
  )
}

function ResultText({result}) {
  const {t} = useTranslation()
  let states = null
  if (result.prevState && result.state)
    states =
      result.prevState === result.state
        ? t(mapToFriendlyStatus(result.state))
        : `${t(mapToFriendlyStatus(result.prevState))} → ${t(
            mapToFriendlyStatus(result.state)
          )}`
  switch (result.kind) {
    case CeremonyResult.Validated:
      return (
        <Stack spacing={0}>
          <Text color="green.500">{t('Validated')}</Text>
          {states && <SmallText>{states}</SmallText>}
        </Stack>
      )
    case CeremonyResult.NotValidated:
      return (
        <Stack spacing={0}>
          <Text color="red.500">{t('Not validated')}</Text>
          {states && <SmallText>{states}</SmallText>}
        </Stack>
      )
    case CeremonyResult.Absent:
      return <Text color="muted">{t('No identity')}</Text>
    case CeremonyResult.Failed:
      return <Text color="orange.500">{t('Ceremony failed')}</Text>
    default:
      return <Text color="muted">–</Text>
  }
}

function answersText(t, {shortAnswers, longAnswers}) {
  if (shortAnswers && longAnswers) return t('Short and long')
  if (shortAnswers) return t('Short only')
  if (longAnswers) return t('Long only')
  return '–'
}

export function CeremoniesTab({history, isOwn}) {
  const {t, i18n} = useTranslation()
  const amount = useAmount()
  const [shown, setShown] = React.useState(ROWS_STEP)
  const rows = React.useMemo(() => ceremonyRows(history), [history])

  return (
    <Stack spacing={4}>
      {!history.ceremoniesComplete && history.epoch > 0 && (
        <SmallText>
          {t(
            'Your node is still finding its past ceremonies in its stored blocks; the list fills in by itself.'
          )}
        </SmallText>
      )}
      {rows.length === 0 ? (
        <FillPlaceholder py={12}>
          {t(
            'No validation of this address in the ceremonies your node knows.'
          )}
        </FillPlaceholder>
      ) : (
        <Table>
          <thead>
            <TableRow>
              <TableHeaderCol>{t('Epoch')}</TableHeaderCol>
              <TableHeaderCol>{t('Validation date')}</TableHeaderCol>
              <TableHeaderCol>{t('Result')}</TableHeaderCol>
              <TableHeaderCol>{t('Score')}</TableHeaderCol>
              <TableHeaderCol>{t('Flips')}</TableHeaderCol>
              {isOwn && <TableHeaderCol>{t('Answers sent')}</TableHeaderCol>}
              <TableHeaderCol className="text-right">
                {t('Rewards, iDNA')}
              </TableHeaderCol>
            </TableRow>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row) => (
              <TableRow key={row.epoch}>
                <TableCol>
                  <Stack spacing={0}>
                    <Text>#{row.epoch}</Text>
                    {isOwn && row.summary?.participated && (
                      <TextLink
                        href={`/validation/report?epoch=${row.epoch}`}
                        fontSize="sm"
                      >
                        {t('Report')}
                      </TextLink>
                    )}
                  </Stack>
                </TableCol>
                <TableCol>{formatDate(row.time, i18n.language)}</TableCol>
                <TableCol>
                  <ResultText result={row.result} />
                </TableCol>
                <TableCol>
                  {row.score
                    ? t('{{points}} of {{flips}}', {
                        points: row.score.points,
                        flips: row.score.flips,
                      })
                    : '–'}
                </TableCol>
                <TableCol>
                  {row.summary?.participated
                    ? row.summary.madeFlips
                    : row.flipsSubmitted || '–'}
                </TableCol>
                {isOwn && <TableCol>{answersText(t, row)}</TableCol>}
                <TableCol className="text-right">
                  {row.summary ? (
                    <Stack spacing={0}>
                      <Text>{row.earned ? amount(row.earned) : '–'}</Text>
                      {row.missed > 0 && (
                        <SmallText color="red.500">
                          {t('{{amount}} missed', {amount: amount(row.missed)})}
                        </SmallText>
                      )}
                    </Stack>
                  ) : (
                    <Text color="muted">–</Text>
                  )}
                </TableCol>
              </TableRow>
            ))}
          </tbody>
        </Table>
      )}
      {rows.length > shown && (
        <ShowMore onClick={() => setShown(shown + ROWS_STEP)} />
      )}
      <SmallText>
        {t(
          'Your node keeps the result of every ceremony since its first block, and the score, flips and rewards of the ceremonies it applied itself (for your address from this version on, for others the last 10).'
        )}
      </SmallText>
    </Stack>
  )
}

function MiningTotal({label, children}) {
  return (
    <Stack spacing={0}>
      <SmallText>{label}</SmallText>
      <Text fontWeight={500}>{children}</Text>
    </Stack>
  )
}

export function MiningTab({history, isOwn}) {
  const {t} = useTranslation()
  const dna = useDna()
  const amount = useAmount()
  const {rows, totals} = React.useMemo(() => miningRows(history), [history])

  if (!isOwn)
    return (
      <FillPlaceholder py={12}>
        {t('Your node records the mining rewards of its own address only.')}
      </FillPlaceholder>
    )
  if (rows.length === 0)
    return (
      <FillPlaceholder py={12}>
        {t(
          'No mining reward recorded yet. Your node records them from this version on, for the blocks it adds.'
        )}
      </FillPlaceholder>
    )
  return (
    <Stack spacing={4}>
      <HStack spacing={10}>
        <MiningTotal label={t('Total rewards')}>
          {dna(totals.total)}
        </MiningTotal>
        <MiningTotal label={t('Epochs')}>{rows.length}</MiningTotal>
        <MiningTotal label={t('Blocks proposed')}>
          {totals.proposedBlocks}
        </MiningTotal>
        <MiningTotal label={t('Committee blocks')}>
          {totals.committeeBlocks}
        </MiningTotal>
      </HStack>
      <Table>
        <thead>
          <TableRow>
            <TableHeaderCol>{t('Epoch')}</TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Blocks proposed')}
            </TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Proposer rewards, iDNA')}
            </TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Committee blocks')}
            </TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Committee rewards, iDNA')}
            </TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Burnt by penalty, iDNA')}
            </TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Total, iDNA')}
            </TableHeaderCol>
          </TableRow>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow key={row.epoch}>
              <TableCol>#{row.epoch}</TableCol>
              <TableCol className="text-right">{row.proposedBlocks}</TableCol>
              <TableCol className="text-right">
                {amount(row.proposerReward)}
              </TableCol>
              <TableCol className="text-right">{row.committeeBlocks}</TableCol>
              <TableCol className="text-right">
                {amount(row.committeeReward)}
              </TableCol>
              <TableCol className="text-right">
                {row.penaltyBurnt > 0 ? (
                  <Text color="red.500">{amount(row.penaltyBurnt)}</Text>
                ) : (
                  '–'
                )}
              </TableCol>
              <TableCol className="text-right">{amount(row.total)}</TableCol>
            </TableRow>
          ))}
        </tbody>
      </Table>
      <SmallText>
        {t(
          'Rewards for the blocks your node added since this version; the current epoch is still counting.'
        )}
      </SmallText>
    </Stack>
  )
}

export function TransactionsTab({address, isOwn}) {
  const {t, i18n} = useTranslation()
  const amountText = useAmount(5)
  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useTransactionPages(address, {enabled: isOwn})

  const txs = React.useMemo(
    () => (data?.pages ?? []).flatMap((page) => page?.transactions ?? []),
    [data]
  )

  if (!isOwn)
    return (
      <FillPlaceholder py={12}>
        {t('Your node keeps the transactions of its own address only.')}
      </FillPlaceholder>
    )
  if (isError)
    return <FillPlaceholder py={12}>{error?.message}</FillPlaceholder>
  if (isLoading)
    return <FillPlaceholder py={12}>{t('Loading...')}</FillPlaceholder>
  if (txs.length === 0)
    return <FillPlaceholder py={12}>{t('No transactions')}</FillPlaceholder>

  return (
    <Stack spacing={4}>
      <Table>
        <thead>
          <TableRow>
            <TableHeaderCol>{t('Date')}</TableHeaderCol>
            <TableHeaderCol>{t('Transaction')}</TableHeaderCol>
            <TableHeaderCol>{t('Address')}</TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Amount, iDNA')}
            </TableHeaderCol>
            <TableHeaderCol className="text-right">
              {t('Fee, iDNA')}
            </TableHeaderCol>
            <TableHeaderCol className="text-right">{t('Epoch')}</TableHeaderCol>
          </TableRow>
        </thead>
        <tbody>
          {txs.map((tx) => {
            const amount = signedAmount(tx, address)
            const other = counterParty(tx, address)
            return (
              <TableRow key={tx.hash}>
                <TableCol>
                  {formatDateTime(tx.timestamp, i18n.language)}
                </TableCol>
                <TableCol>
                  <Stack spacing={0}>
                    <Text>{t(txTypeName(tx))}</Text>
                    <SmallText fontFamily="mono" isTruncated maxW={32}>
                      {tx.hash}
                    </SmallText>
                  </Stack>
                </TableCol>
                <TableCol>
                  <Box fontFamily="mono" fontSize="sm" isTruncated maxW={48}>
                    {other ?? '–'}
                  </Box>
                </TableCol>
                <TableCol className="text-right">
                  {amount ? (
                    <Text color={amount < 0 ? 'red.500' : undefined}>
                      {amountText(amount)}
                    </Text>
                  ) : (
                    '–'
                  )}
                </TableCol>
                <TableCol className="text-right">
                  {toNumber(tx.usedFee)
                    ? amountText(toNumber(tx.usedFee))
                    : '–'}
                </TableCol>
                <TableCol className="text-right">#{tx.epoch}</TableCol>
              </TableRow>
            )
          })}
        </tbody>
      </Table>
      {hasNextPage && (
        <Flex justify="center">
          <OutlineButton
            isLoading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {t('Show more')}
          </OutlineButton>
        </Flex>
      )}
    </Stack>
  )
}
