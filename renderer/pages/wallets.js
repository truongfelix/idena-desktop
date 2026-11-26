import React from 'react'
import {useTranslation} from 'react-i18next'
import {Flex, Stack, Box, Heading, useDisclosure} from '@chakra-ui/react'
import {useWallets} from '../shared/hooks/use-wallets'
import {IconButton2} from '../shared/components/button'
import Layout from '../shared/components/layout'
import {useChainState} from '../shared/providers/chain-context'
import {
  TextLink,
  Page,
  PageTitle,
  VDivider,
} from '../shared/components/components'
import {
  ReceiveDnaDrawer,
  SendDnaDrawer,
  TotalAmount,
  WalletCard,
  TransactionDetailsDrawer,
  WalletTransactionList,
} from '../screens/wallets/containers'
import {useTransactionDetailsDrawer} from '../screens/wallets/hooks'
import {useFailToast} from '../shared/hooks/use-toast'
import {useIdentityState} from '../shared/providers/identity-context'
import {areSameCaseInsensitive} from '../screens/oracles/utils'
import {TransactionHistory} from '../screens/history/components'
import {SendOutIcon} from '../shared/components/icons'

export default function WalletsPage() {
  const {t} = useTranslation(['translation', 'error'])

  const {syncing, offline} = useChainState()

  const {address} = useIdentityState()

  const {wallets, totalAmount, txs} = useWallets()

  // The node's list (TransactionHistory) has the mined transactions only: the ones still in the mempool come first.
  const pendingTxs = React.useMemo(
    () => (txs ?? []).filter((tx) => tx.isMining),
    [txs]
  )

  const sendDnaDisclosure = useDisclosure()
  const {onOpen: onOpenSendDnaDrawer} = sendDnaDisclosure

  const {
    isOpen: isOpenReceiveDnaDrawer,
    onOpen: onOpenReceiveDnaDrawer,
    onClose: onCloseReceiveDnaDrawer,
  } = useDisclosure()

  const {open: openTransaction, drawerProps: transactionDrawerProps} =
    useTransactionDetailsDrawer()

  const failToast = useFailToast()

  return (
    <Layout syncing={syncing} offline={offline}>
      <Page>
        <PageTitle>{t('Wallets')}</PageTitle>
        <Stack spacing={8} w="full">
          <Flex justify="space-between" align="flex-start">
            <Box pt="1/2" pb={2}>
              <TotalAmount amount={totalAmount} />
            </Box>
            <Stack isInline spacing={1} align="center" pt={2}>
              <VDivider />
              <IconButton2
                icon={<SendOutIcon transform="scaleX(-1)" />}
                onClick={onOpenSendDnaDrawer}
              >
                {t('Send')}
              </IconButton2>
              <VDivider />
              <IconButton2
                icon={<SendOutIcon />}
                onClick={onOpenReceiveDnaDrawer}
              >
                {t('Receive')}
              </IconButton2>
            </Stack>
          </Flex>
          <Stack isInline spacing="6">
            {wallets.map((wallet) => (
              <WalletCard
                key={wallet.address + wallet.name}
                wallet={wallet}
                isSelected={areSameCaseInsensitive(wallet.name, 'main')}
                onSend={onOpenSendDnaDrawer}
                onReceive={onOpenReceiveDnaDrawer}
              />
            ))}
          </Stack>
          {pendingTxs.length > 0 && (
            <Stack spacing={4}>
              <Heading
                as="h2"
                fontSize="lg"
                fontWeight={500}
                lineHeight="short"
              >
                {t('Waiting to be mined')}
              </Heading>
              <WalletTransactionList
                txs={pendingTxs}
                onOpenTransaction={openTransaction}
              />
            </Stack>
          )}
          <Stack spacing={4}>
            <Stack spacing="1px">
              <Heading
                as="h2"
                fontSize="lg"
                fontWeight={500}
                lineHeight="short"
              >
                {t('Transactions')}
              </Heading>
              <TextLink href="/home" fontWeight={500}>
                {t('Validation rewards and penalties in My Idena')}
              </TextLink>
            </Stack>
            <TransactionHistory address={address} />
          </Stack>
        </Stack>

        <SendDnaDrawer
          {...sendDnaDisclosure}
          address={address}
          onFail={(error) => {
            failToast({
              title: t('Error while sending transaction'),
              description: error,
            })
          }}
        />

        <ReceiveDnaDrawer
          address={address}
          isOpen={isOpenReceiveDnaDrawer}
          onClose={onCloseReceiveDnaDrawer}
        />

        <TransactionDetailsDrawer {...transactionDrawerProps} />
      </Page>
    </Layout>
  )
}
