/* eslint-disable react/prop-types */
import React from 'react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {Box, Button, Flex, HStack, Stack, Text} from '@chakra-ui/react'
import Layout from '../shared/components/layout'
import {SmallText, Page, PageTitle} from '../shared/components/components'
import {PrimaryButton} from '../shared/components/button'
import {useSocial} from '../screens/social/provider'
import {isSocialAddress} from '../screens/social/people'
import {
  NameDialog,
  SocialInfoDialog,
} from '../screens/social/components/dialogs'
import {Editor} from '../screens/social/components/editor'
import {StatusDot} from '../screens/social/components/identity'
import {ConfirmDialog} from '../screens/social/components/send-dialogs'
import {PostTarget} from '../screens/social/contract'
import {SocialThread} from '../screens/social/components/thread'
import {idKey} from '../screens/social/feed'
import {scanState} from '../screens/social/scan'
import {TabButton, useNow} from '../screens/social/views/common'
import {Home} from '../screens/social/views/home'
import {Inbox, InboxView} from '../screens/social/views/inbox'
import {ProfileView} from '../screens/social/views/profile'

const View = {Home: 'home', Profile: 'profile', Inbox: 'inbox'}

/**
 * idena.social, read from the app's own node and laid out as the phone app's Social tab: Home (search, Feed or
 * Following, sorts), Profile (yours), Inbox (notifications and contacts); a thread or another profile opens on top.
 */
export default function SocialPage() {
  const {t} = useTranslation()
  const router = useRouter()
  const {query} = router
  const now = useNow()
  const social = useSocial()
  const {
    cache,
    feed,
    head,
    error,
    missingMethod,
    node,
    me,
    unread,
    scanOff,
    setPageOpen,
    sending,
  } = social
  const [isInfoOpen, setIsInfoOpen] = React.useState(false)
  const [renaming, setRenaming] = React.useState(null)

  React.useEffect(() => {
    setPageOpen(true)
    return () => setPageOpen(false)
  }, [setPageOpen])

  // Each view opens at its top, as a new screen of the phone app.
  const pageRef = React.useRef()
  React.useEffect(() => {
    pageRef.current?.scrollTo(0, 0)
  }, [query.view, query.inbox, query.post, query.address])

  const view = Object.values(View).includes(query.view) ? query.view : View.Home
  const inboxView = Object.values(InboxView).includes(query.inbox)
    ? query.inbox
    : InboxView.Notifications
  const go = (next) =>
    router.push({pathname: '/social', query: next}, undefined, {shallow: true})
  const openThread = (id, focus) =>
    go(focus !== undefined ? {post: id, focus} : {post: id})
  const openProfile = (address) =>
    address?.toLowerCase() === me
      ? go({view: View.Profile})
      : go({address: address.toLowerCase()})

  // Ids as text: an older contract version's carry its prefix ("preV5:12").
  const postId = query.post !== undefined ? idKey(query.post) : null
  // Opened from a profile, the inbox or the search: that item is shown and marked.
  const focusId = query.focus !== undefined ? idKey(query.focus) : null
  const thread = React.useMemo(
    () => (postId === null ? null : feed.find(({id}) => idKey(id) === postId)),
    [feed, postId]
  )
  const profileAddress = isSocialAddress(query.address)
    ? String(query.address).toLowerCase()
    : null
  const onPage = postId !== null || profileAddress !== null

  const state = scanOff
    ? {health: 'off', kind: 'scanOff'}
    : scanState(node, head, cache)

  const status = sending.status && (
    <Text fontSize="sm" color={sending.status.error ? 'red.500' : 'muted'}>
      {sending.status.text}
    </Text>
  )

  let content
  // The editor takes the page while it is open, as on the phone.
  if (sending.draft) content = <Editor now={now} status={status} />
  else if (postId !== null)
    content = thread ? (
      <SocialThread
        node={thread}
        now={now}
        focusId={focusId}
        onProfile={openProfile}
      />
    ) : (
      <SmallText>{t('This post is not in the blocks read so far.')}</SmallText>
    )
  else if (profileAddress)
    content = (
      <ProfileView
        address={profileAddress}
        now={now}
        openThread={openThread}
        openProfile={openProfile}
        onRename={setRenaming}
      />
    )
  else if (view === View.Profile)
    content = me ? (
      <ProfileView
        address={me}
        now={now}
        openThread={openThread}
        openProfile={openProfile}
        onRename={setRenaming}
      />
    ) : (
      <SmallText>{t("Waiting for the node's address…")}</SmallText>
    )
  else if (view === View.Inbox)
    content = (
      <Inbox
        view={inboxView}
        setView={(next) => go({view: View.Inbox, inbox: next})}
        now={now}
        openThread={openThread}
        openProfile={openProfile}
        onRename={setRenaming}
      />
    )
  else
    content = (
      <Home
        now={now}
        openThread={openThread}
        openProfile={openProfile}
        onRename={setRenaming}
      />
    )

  // The page needs no synced node to show what was read: it stays shown while the node syncs.
  return (
    <Layout>
      <Page ref={pageRef}>
        <Stack spacing={4} w="full" maxW="3xl">
          <Flex align="center" justify="space-between">
            <PageTitle mb={0}>{t('Social')}</PageTitle>
            <HStack
              as="button"
              spacing={2}
              onClick={() => setIsInfoOpen(true)}
              title={t('Details')}
            >
              <StatusDot health={state.health} size={3} />
              {node?.peers > 0 && (
                <Text fontWeight={500} color="muted">
                  {node.peers}
                </Text>
              )}
              <Text color="muted">ⓘ</Text>
            </HStack>
          </Flex>
          {missingMethod && (
            <Text fontSize="sm" color="red.500">
              {t(
                'This node cannot read idena.social. It needs a node version with the bcn_contractCalls method, as the one built into this app.'
              )}
            </Text>
          )}
          {error && !missingMethod && (
            <SmallText>
              {error.timeout
                ? t('The node took too long to answer. Trying again.')
                : t('The last read failed ({{message}}). Trying again.', {
                    message: error.message,
                  })}
            </SmallText>
          )}
          {!sending.draft &&
            (onPage ? (
              <Button
                variant="link"
                alignSelf="flex-start"
                onClick={() => router.back()}
              >
                ← {t('Back')}
              </Button>
            ) : (
              <HStack spacing={1}>
                <TabButton
                  isActive={view === View.Home}
                  onClick={() => go({view: View.Home})}
                >
                  {t('Home')}
                </TabButton>
                <TabButton
                  isActive={view === View.Profile}
                  onClick={() => go({view: View.Profile})}
                >
                  {t('Profile')}
                </TabButton>
                <TabButton
                  isActive={view === View.Inbox}
                  badge={unread.length}
                  onClick={() => go({view: View.Inbox})}
                >
                  {t('Inbox')}
                </TabButton>
                <Box flex={1} />
                <PrimaryButton
                  isDisabled={!sending.canAct}
                  onClick={() => sending.startDraft(PostTarget.newPost())}
                >
                  {t('Post')}
                </PrimaryButton>
              </HStack>
            ))}
          {!sending.draft && status}
          {content}
        </Stack>
        {isInfoOpen && (
          <SocialInfoDialog
            state={state}
            onClose={() => setIsInfoOpen(false)}
          />
        )}
        {sending.confirm && (
          <ConfirmDialog
            pending={sending.confirm}
            onSend={sending.send}
            onCancel={sending.cancelConfirm}
          />
        )}
        {renaming && (
          <NameDialog
            key={renaming}
            address={renaming}
            onClose={() => setRenaming(null)}
          />
        )}
      </Page>
    </Layout>
  )
}
