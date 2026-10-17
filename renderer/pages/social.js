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
import {
  SOCIAL_FONT_SIZES,
  TabButton,
  useNow,
} from '../screens/social/views/common'
import {Home} from '../screens/social/views/home'
import {Notifications} from '../screens/social/views/inbox'
import {ProfileView} from '../screens/social/views/profile'
import {WaitingLine} from '../screens/social/components/waiting-line'
import {TopicView} from '../screens/social/views/topic'
import {SettingsTab, SocialSettingsView} from '../screens/social/views/settings'
import {ChatView, MessagesList} from '../screens/social/views/messages'
import {OpenTopicContext} from '../screens/social/components/topic'
import {topicOf, topicChannel} from '../screens/social/topics'
import {threadPost} from '../screens/social/hiding'

const View = {
  Feed: 'feed',
  Messages: 'messages',
  Notifications: 'notifications',
  Profile: 'profile',
  Settings: 'settings',
}

/** A view of an older link: Home is the Feed; the Inbox, its Messages or its Notifications. */
const viewOf = ({view, inbox}) => {
  if (view === 'home') return View.Feed
  if (view === 'inbox')
    return inbox === 'messages' ? View.Messages : View.Notifications
  return Object.values(View).includes(view) ? view : View.Feed
}

/**
 * idena.social, read from the app's own node and laid out as the phone app's Social tab: four tabs, Feed (the search
 * with the feed's filter at its end), Messages, Notifications and Profile (yours; its ⚙ opens Social settings: the
 * people and topics followed, what is muted, blocked and hidden); a thread, another profile or a topic opens on top.
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
    hidden,
    head,
    error,
    missingMethod,
    node,
    me,
    unread,
    unreadConversations,
    offersTo,
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
  }, [
    query.view,
    query.inbox,
    query.post,
    query.address,
    query.topic,
    query.chat,
  ])

  const view = viewOf(query)
  const settingsTab = Object.values(SettingsTab).includes(query.tab)
    ? query.tab
    : SettingsTab.People
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
  // A post hidden still opens (folded); a blocked account's does not.
  const thread = React.useMemo(
    () => (postId === null ? null : threadPost(feed, postId, hidden, me)),
    [feed, hidden, me, postId]
  )
  const profileAddress = isSocialAddress(query.address)
    ? String(query.address).toLowerCase()
    : null
  const topic =
    query.topic !== undefined ? topicOf(topicChannel(query.topic)) : null
  const openTopic = React.useCallback(
    (name) =>
      router.push({pathname: '/social', query: {topic: name}}, undefined, {
        shallow: true,
      }),
    [router]
  )
  // A conversation by its key: its participants, lowercase, sorted, joined by "-".
  const chatKey =
    typeof query.chat === 'string' &&
    /^0x[0-9a-f]{40}(-0x[0-9a-f]{40})*$/.test(query.chat)
      ? query.chat
      : null
  const openChat = (key) => go({chat: key})
  const onPage =
    chatKey !== null ||
    postId !== null ||
    profileAddress !== null ||
    topic !== null ||
    view === View.Settings

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
      <SmallText>
        {feed.some(({id}) => idKey(id) === postId)
          ? t(
              'Its author is blocked. Unblock them in Social settings to see it.'
            )
          : t('This post is not in the blocks read so far.')}
      </SmallText>
    )
  else if (chatKey !== null)
    content = <ChatView chatKey={chatKey} now={now} openProfile={openProfile} />
  else if (topic !== null)
    content = (
      <TopicView
        name={topic}
        now={now}
        openThread={openThread}
        openProfile={openProfile}
      />
    )
  else if (profileAddress)
    content = (
      <ProfileView
        address={profileAddress}
        now={now}
        openThread={openThread}
        openProfile={openProfile}
        onRename={setRenaming}
        openChat={openChat}
        openSettings={() => go({view: View.Settings})}
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
        openSettings={() => go({view: View.Settings})}
      />
    ) : (
      <SmallText>{t("Waiting for the node's address…")}</SmallText>
    )
  else if (view === View.Settings)
    content = (
      <SocialSettingsView
        tab={settingsTab}
        setTab={(next) =>
          router.replace(
            {pathname: '/social', query: {view: View.Settings, tab: next}},
            undefined,
            {shallow: true}
          )
        }
        now={now}
        openThread={openThread}
        openProfile={openProfile}
        onRename={setRenaming}
      />
    )
  else if (view === View.Messages)
    content = <MessagesList now={now} openChat={openChat} />
  else if (view === View.Notifications)
    content = (
      <Notifications
        now={now}
        openThread={openThread}
        openProfile={openProfile}
      />
    )
  else
    content = (
      <Home
        now={now}
        openThread={openThread}
        openProfile={openProfile}
        onRename={setRenaming}
        openList={(list) =>
          go({
            view: View.Settings,
            tab: list === 'topics' ? SettingsTab.Topics : SettingsTab.People,
          })
        }
      />
    )

  // The page needs no synced node to show what was read: it stays shown while the node syncs.
  return (
    <Layout>
      <OpenTopicContext.Provider value={openTopic}>
        <Page ref={pageRef}>
          <Stack spacing={4} w="full" maxW="3xl" sx={SOCIAL_FONT_SIZES}>
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
            <WaitingLine />
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
                    isActive={view === View.Feed}
                    onClick={() => go({view: View.Feed})}
                  >
                    {t('Feed')}
                  </TabButton>
                  <TabButton
                    isActive={view === View.Messages}
                    badge={unreadConversations}
                    onClick={() => go({view: View.Messages})}
                  >
                    {t('Messages')}
                  </TabButton>
                  <TabButton
                    isActive={view === View.Notifications}
                    badge={unread.length + offersTo.length}
                    onClick={() => go({view: View.Notifications})}
                  >
                    {t('Notifications')}
                  </TabButton>
                  <TabButton
                    isActive={view === View.Profile}
                    onClick={() => go({view: View.Profile})}
                  >
                    {t('Profile')}
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
      </OpenTopicContext.Provider>
    </Layout>
  )
}
