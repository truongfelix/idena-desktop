/* eslint-disable react/prop-types */
import React from 'react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Button,
  Divider,
  Flex,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Stack,
  Text,
  useClipboard,
} from '@chakra-ui/react'
import Layout from '../shared/components/layout'
import {
  Avatar,
  Dialog,
  DialogBody,
  DialogFooter,
  Page,
  PageTitle,
  SmallText,
} from '../shared/components/components'
import {SecondaryButton} from '../shared/components/button'
import {TodoVotingCountBadge} from '../screens/oracles/components'
import {useSocial} from '../screens/social/provider'
import {useSocialIdentity} from '../screens/social/hooks'
import {
  ActivityCard,
  Chip,
  FollowChip,
  NameDialog,
  PostRow,
  ProfileItemCard,
  SocialInfoDialog,
  SocialThread,
  StatusDot,
  notifyKindLabels,
} from '../screens/social/components'
import {
  MIN_SEARCH,
  displayName,
  followingFeed,
  isSocialAddress,
  mergePeople,
  peopleFromJson,
  peopleToJson,
  searchSocial,
  shortAddress,
  sortedPeople,
} from '../screens/social/people'
import {
  FeedPeriod,
  FeedSort,
  NotifyKind,
  historyDone,
  identityColor,
  identityStatus,
  scanState,
  socialProfile,
  sortFeed,
} from '../screens/social/utils'

const PAGE_SIZE = 30
const MAX_IMPORT_BYTES = 2000000

const View = {Home: 'home', Profile: 'profile', Inbox: 'inbox'}
const InboxView = {Notifications: 'notifications', Contacts: 'contacts'}

const useNow = () => {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000))
  React.useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      30000
    )
    return () => clearInterval(timer)
  }, [])
  return now
}

function ShowMore({shown, total, onMore}) {
  const {t} = useTranslation()
  if (shown >= total) return null
  return (
    <Button variant="link" alignSelf="flex-start" onClick={onMore}>
      {t('Show more ({{count}} left)', {count: total - shown})}
    </Button>
  )
}

function Rows({children}) {
  const items = React.Children.toArray(children)
  return (
    <Stack spacing={0} w="full" divider={<Divider />}>
      {items}
    </Stack>
  )
}

function SearchField({value, onChange}) {
  const {t} = useTranslation()
  return (
    <InputGroup>
      <InputLeftElement pointerEvents="none" color="muted">
        🔍
      </InputLeftElement>
      <Input
        value={value}
        maxLength={200}
        rounded="full"
        bg="gray.50"
        borderColor="gray.50"
        placeholder={t('Search')}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <InputRightElement>
          <Button variant="ghost" size="sm" onClick={() => onChange('')}>
            ✕
          </Button>
        </InputRightElement>
      )}
    </InputGroup>
  )
}

function ContactRow({contact, onProfile, onRename}) {
  const {t} = useTranslation()
  return (
    <HStack
      spacing={3}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={() => onProfile(contact.address)}
    >
      <Avatar address={contact.address} boxSize={10} rounded="md" />
      <Stack spacing={0} flex={1} minW={0}>
        <Text fontWeight={500} noOfLines={1}>
          {contact.name || shortAddress(contact.address)}
        </Text>
        {contact.name && (
          <SmallText fontFamily="mono">
            {shortAddress(contact.address)}
          </SmallText>
        )}
      </Stack>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label={t('Rename')}
        title={t('Rename')}
        icon={<Text>✎</Text>}
        onClick={(e) => {
          e.stopPropagation()
          onRename(contact.address)
        }}
      />
      <FollowChip address={contact.address} />
    </HStack>
  )
}

function Home({now, openThread, openProfile, onRename}) {
  const {t} = useTranslation()
  const {feed, people, names, epochStart} = useSocial()
  const [query, setQuery] = React.useState('')
  const [searched, setSearched] = React.useState('')
  const [following, setFollowing] = React.useState(false)
  const [sort, setSort] = React.useState(FeedSort.Newest)
  const [period, setPeriod] = React.useState(FeedPeriod.Epoch)
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    const timer = setTimeout(() => setSearched(query), 250)
    return () => clearTimeout(timer)
  }, [query])
  React.useEffect(() => setShown(PAGE_SIZE), [following, sort, period])

  const sortLabels = {
    [FeedSort.Newest]: t('Newest posts'),
    [FeedSort.Activity]: t('Latest activity'),
    [FeedSort.Likes]: t('Most liked'),
    [FeedSort.Comments]: t('Most commented'),
    [FeedSort.Tips]: t('Most tipped'),
  }
  const ranked = ![FeedSort.Newest, FeedSort.Activity].includes(sort)
  const posts = React.useMemo(
    () =>
      sortFeed(following ? followingFeed(feed, people) : feed, sort, {
        period,
        now,
        epochStart,
      }),
    [epochStart, feed, following, now, people, period, sort]
  )
  const searching = searched.trim().length >= MIN_SEARCH
  const hits = React.useMemo(
    () => (searching ? searchSocial(feed, people, searched) : []),
    [feed, people, searched, searching]
  )

  let empty = t('No posts found yet.')
  if (following && !Object.values(people).some((p) => p.following))
    empty = t('You follow nobody yet. Open a profile and select Follow.')
  else if (sort === FeedSort.Likes) empty = t('No liked post in this period.')
  else if (sort === FeedSort.Comments)
    empty = t('No post with answers in this period.')
  else if (sort === FeedSort.Tips) empty = t('No tipped post in this period.')

  return (
    <Stack spacing={3} w="full">
      <SearchField value={query} onChange={setQuery} />
      {searching ? (
        <Stack spacing={2}>
          {hits.length === 0 && (
            <SmallText>
              {t('Nothing found in the posts read so far.')}
            </SmallText>
          )}
          {hits.map((hit) => {
            if (hit.kind === 'address')
              return (
                <HStack
                  key={`a-${hit.address}`}
                  spacing={3}
                  borderWidth={1}
                  borderColor="gray.100"
                  rounded="lg"
                  p={3}
                  cursor="pointer"
                  onClick={() => openProfile(hit.address)}
                >
                  <Avatar address={hit.address} boxSize={10} rounded="md" />
                  <Stack spacing={0}>
                    <Text fontWeight={500}>
                      {t('Open the profile of {{name}}', {
                        name: displayName(hit.address, names),
                      })}{' '}
                      ›
                    </Text>
                    <SmallText fontFamily="mono">
                      {shortAddress(hit.address)}
                    </SmallText>
                  </Stack>
                </HStack>
              )
            if (hit.kind === 'person')
              return (
                <ContactRow
                  key={`p-${hit.person.address}`}
                  contact={hit.person}
                  onProfile={openProfile}
                  onRename={onRename}
                />
              )
            return (
              <PostRow
                key={`t-${hit.node.id}`}
                node={hit.node}
                now={now}
                onOpen={() => openThread(hit.threadId, hit.node.id)}
                onProfile={openProfile}
              />
            )
          })}
        </Stack>
      ) : (
        <>
          <HStack spacing={2} flexWrap="wrap">
            <Chip isSelected={!following} onClick={() => setFollowing(false)}>
              {t('Feed')}
            </Chip>
            <Chip isSelected={following} onClick={() => setFollowing(true)}>
              {t('Following')}
            </Chip>
            <Menu autoSelect={false}>
              <MenuButton
                as={Button}
                size="sm"
                h={8}
                variant="outline"
                borderColor="gray.100"
                fontWeight={500}
              >
                {sortLabels[sort]} ▾
              </MenuButton>
              <MenuList zIndex="popover">
                {Object.values(FeedSort).map((value) => (
                  <MenuItem key={value} onClick={() => setSort(value)}>
                    {sortLabels[value]}
                  </MenuItem>
                ))}
              </MenuList>
            </Menu>
            {ranked && (
              <>
                <Chip
                  isSelected={period === FeedPeriod.Epoch}
                  onClick={() => setPeriod(FeedPeriod.Epoch)}
                >
                  {t('This epoch')}
                </Chip>
                <Chip
                  isSelected={period === FeedPeriod.Week}
                  onClick={() => setPeriod(FeedPeriod.Week)}
                >
                  {t('7 days')}
                </Chip>
                <Chip
                  isSelected={period === FeedPeriod.All}
                  onClick={() => setPeriod(FeedPeriod.All)}
                >
                  {t('All')}
                </Chip>
              </>
            )}
          </HStack>
          <Divider />
          {posts.length === 0 && <SmallText>{empty}</SmallText>}
          <Rows>
            {posts.slice(0, shown).map((node) => (
              <PostRow
                key={node.id}
                node={node}
                now={now}
                onOpen={() => openThread(node.id)}
                onProfile={openProfile}
              />
            ))}
          </Rows>
          <ShowMore
            shown={shown}
            total={posts.length}
            onMore={() => setShown(shown + PAGE_SIZE)}
          />
        </>
      )}
    </Stack>
  )
}

function CopyButton({value}) {
  const {t} = useTranslation()
  const {hasCopied, onCopy} = useClipboard(value)
  return (
    <IconButton
      variant="ghost"
      size="xs"
      aria-label={t('Copy the address')}
      title={t('Copy the address')}
      icon={<Text>{hasCopied ? '✓' : '⧉'}</Text>}
      onClick={onCopy}
    />
  )
}

function ProfileView({address, now, openThread, openProfile, onRename}) {
  const {t} = useTranslation()
  const {feed, me, people, cache} = useSocial()
  const {data: identity, isError} = useSocialIdentity(address)
  const profile = React.useMemo(
    () => socialProfile(feed, address),
    [address, feed]
  )
  const [tab, setTab] = React.useState('posts')
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => setShown(PAGE_SIZE), [tab, address])
  const name = people[address]?.name
  const isMe = address === me
  const status = identityStatus(identity?.state)
  const tabs = [
    ['posts', t('Posts')],
    ['replies', t('Replies')],
    ['comments', t('Comments')],
    ['likes', t('Likes')],
    ['tips', t('Tips')],
    ['media', t('Media')],
  ]
  const items = profile[tab]

  let statusLine = t('Identity: asking the node…', {nsSeparator: '|'})
  if (isError)
    statusLine = t('Identity: the node did not answer.', {nsSeparator: '|'})
  else if (identity)
    statusLine = [
      t(status),
      identity.age > 0 &&
        status !== 'Not validated' &&
        t('age {{age}}', {age: identity.age}),
      Number(identity.stake) > 0 &&
        t('stake {{stake}} iDNA', {
          stake: Math.floor(Number(identity.stake)).toLocaleString(),
        }),
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <Stack spacing={3} w="full">
      <HStack spacing={3} align="center">
        <Avatar address={address} boxSize={16} rounded="lg" />
        <Stack spacing={0.5} flex={1} minW={0}>
          <HStack spacing={1}>
            <Text fontSize="lg" fontWeight={500} noOfLines={1}>
              {name || shortAddress(address)}
              {isMe && ` ${t('(you)')}`}
            </Text>
            {!name && <CopyButton value={address} />}
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={name ? t('Rename') : t('Name')}
              title={name ? t('Rename') : t('Name')}
              icon={<Text>✎</Text>}
              onClick={() => onRename(address)}
            />
            <Box flex={1} />
            {!isMe && <FollowChip address={address} />}
          </HStack>
          {name && (
            <HStack spacing={1}>
              <Text fontFamily="mono" fontSize="sm" color="muted">
                {shortAddress(address)}
              </Text>
              <CopyButton value={address} />
            </HStack>
          )}
          <Text
            fontSize="md"
            fontWeight={500}
            color={identityColor(identity?.state) || 'muted'}
          >
            {statusLine}
          </Text>
        </Stack>
      </HStack>
      <Stack spacing={0.5} fontSize="md">
        <Text>
          {`❤️ ${t('{{received}} received · {{given}} given', {
            received: profile.likesReceived,
            given: profile.likes.length,
          })}`}
        </Text>
        <Text>
          {`🪙 ${t('{{received}} received · {{given}} given iDNA', {
            received: profile.tipsReceived,
            given: profile.tipsGiven,
          })}`}
        </Text>
      </Stack>
      {cache && !historyDone(cache) && (
        <SmallText>
          {t(
            'From the blocks read so far. Older posts appear as the history scan goes on.'
          )}
        </SmallText>
      )}
      <HStack spacing={2} flexWrap="wrap">
        {tabs.map(([value, label]) => (
          <Chip
            key={value}
            isSelected={tab === value}
            onClick={() => setTab(value)}
          >
            {`${label} ${profile[value].length}`}
          </Chip>
        ))}
      </HStack>
      {items.length === 0 && <SmallText>{t('Nothing here yet.')}</SmallText>}
      {tab === 'posts' ? (
        <Rows>
          {items.slice(0, shown).map((item) => (
            <PostRow
              key={item.node.id}
              node={item.node}
              now={now}
              onOpen={() => openThread(item.threadId, item.node.id)}
              onProfile={openProfile}
            />
          ))}
        </Rows>
      ) : (
        <Stack spacing={2}>
          {items.slice(0, shown).map((item) => (
            <ProfileItemCard
              key={`${item.node.id}-${item.like?.hash || item.tip?.hash || ''}`}
              item={item}
              tab={tab}
              now={now}
              onOpen={() => openThread(item.threadId, item.node.id)}
              onProfile={openProfile}
            />
          ))}
        </Stack>
      )}
      <ShowMore
        shown={shown}
        total={items.length}
        onMore={() => setShown(shown + PAGE_SIZE)}
      />
    </Stack>
  )
}

function Notifications({now, openThread, openProfile}) {
  const {t} = useTranslation()
  const {
    activity,
    highlightAfter,
    markSeen,
    notifyKinds,
    setNotifyKinds,
    setInboxOpen,
  } = useSocial()
  const [isInfoOpen, setIsInfoOpen] = React.useState(false)
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    setInboxOpen(true)
    return () => setInboxOpen(false)
  }, [setInboxOpen])
  // What arrives while the list is open is seen too.
  React.useEffect(() => {
    markSeen()
  }, [activity, markSeen])
  const labels = notifyKindLabels(t)
  return (
    <Stack spacing={3} w="full">
      <HStack spacing={2}>
        {Object.values(NotifyKind).map((kind) => (
          <Chip
            key={kind}
            isSelected={notifyKinds.includes(kind)}
            onClick={() =>
              setNotifyKinds(
                notifyKinds.includes(kind)
                  ? notifyKinds.filter((k) => k !== kind)
                  : notifyKinds.concat(kind)
              )
            }
          >
            {labels[kind]}
          </Chip>
        ))}
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={t('Notifications')}
          title={t('Notifications')}
          icon={<Text>🔔</Text>}
          onClick={() => setIsInfoOpen(true)}
        />
      </HStack>
      {activity.length === 0 && (
        <SmallText>
          {t('No likes, answers or tips on your posts yet.')}
        </SmallText>
      )}
      {activity.slice(0, shown).map((item) => (
        <ActivityCard
          key={`${item.kind}-${item.height}-${item.index}-${item.focusId}`}
          item={item}
          now={now}
          isNew={highlightAfter !== null && item.height > highlightAfter}
          onOpen={() => openThread(item.threadId, item.focusId)}
          onProfile={openProfile}
        />
      ))}
      <ShowMore
        shown={shown}
        total={activity.length}
        onMore={() => setShown(shown + PAGE_SIZE)}
      />
      {isInfoOpen && (
        <Dialog
          title={t('Notifications')}
          isOpen
          onClose={() => setIsInfoOpen(false)}
        >
          <DialogBody>
            <Text color="muted">
              {t(
                'A notice comes for each new like, comment or tip on your posts, of the kinds selected. All of them are listed here.'
              )}
            </Text>
          </DialogBody>
          <DialogFooter>
            <SecondaryButton onClick={() => setIsInfoOpen(false)}>
              {t('Close')}
            </SecondaryButton>
          </DialogFooter>
        </Dialog>
      )}
    </Stack>
  )
}

function Contacts({openProfile, onRename}) {
  const {t} = useTranslation()
  const {people, setPeople} = useSocial()
  const [note, setNote] = React.useState(null)
  const [isInfoOpen, setIsInfoOpen] = React.useState(false)
  const fileRef = React.useRef()
  const list = sortedPeople(people)

  const exportList = () => {
    const blob = new Blob([JSON.stringify(peopleToJson(people), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'idena-contacts.json'
    link.click()
    // The app asks where to save it, as a download.
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    setNote(null)
  }

  const importList = async (file) => {
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error(t('the file is too large'))
      const json = JSON.parse(await file.text())
      if (!Array.isArray(json?.people))
        throw new Error(t('this is not an exported contact list'))
      const result = mergePeople(people, peopleFromJson(json))
      setPeople(result.people)
      setNote(
        t('Imported {{added}} contacts added, {{changed}} changed.', {
          added: result.added,
          changed: result.changed,
        })
      )
    } catch (error) {
      setNote(t('Import failed ({{message}}).', {message: error.message}))
    }
  }

  return (
    <Stack spacing={3} w="full">
      <HStack spacing={2}>
        <Chip isDisabled={list.length === 0} onClick={exportList}>
          {t('Export')}
        </Chip>
        <Chip onClick={() => fileRef.current?.click()}>{t('Import')}</Chip>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const [file] = e.target.files || []
            if (file) importList(file)
            e.target.value = ''
          }}
        />
        <Box flex={1} />
        <Button variant="ghost" size="sm" onClick={() => setIsInfoOpen(true)}>
          ⓘ
        </Button>
      </HStack>
      {note && (
        <Text fontSize="sm" color="blue.500">
          {note}
        </Text>
      )}
      {list.length === 0 && <SmallText>{t('No contacts yet.')}</SmallText>}
      {list.map((contact) => (
        <ContactRow
          key={contact.address}
          contact={contact}
          onProfile={openProfile}
          onRename={onRename}
        />
      ))}
      {isInfoOpen && (
        <Dialog
          title={t('Contacts')}
          isOpen
          onClose={() => setIsInfoOpen(false)}
        >
          <DialogBody>
            <Stack spacing={3} color="muted">
              <Text>
                {t(
                  'Names and follows stay on this computer: nobody else sees them. A name shows instead of the address in the Social tab; the posts of the people you follow make the Following feed.',
                  {nsSeparator: '|'}
                )}
              </Text>
              <Text>
                {t(
                  'To add someone, open a profile and select ✎ or Follow. Export saves the list to a file; Import merges a file in (from this computer or the phone app) without removing anything.'
                )}
              </Text>
            </Stack>
          </DialogBody>
          <DialogFooter>
            <SecondaryButton onClick={() => setIsInfoOpen(false)}>
              {t('Close')}
            </SecondaryButton>
          </DialogFooter>
        </Dialog>
      )}
    </Stack>
  )
}

function Inbox({view, setView, now, openThread, openProfile, onRename}) {
  const {t} = useTranslation()
  const {unread} = useSocial()
  return (
    <Stack spacing={3} w="full">
      <HStack spacing={2}>
        <Chip
          isSelected={view === InboxView.Notifications}
          onClick={() => setView(InboxView.Notifications)}
        >
          {unread.length > 0
            ? t('Notifications · {{count}} new', {count: unread.length})
            : t('Notifications')}
        </Chip>
        <Chip
          isSelected={view === InboxView.Contacts}
          onClick={() => setView(InboxView.Contacts)}
        >
          {t('Contacts')}
        </Chip>
      </HStack>
      <Divider />
      {view === InboxView.Contacts ? (
        <Contacts openProfile={openProfile} onRename={onRename} />
      ) : (
        <Notifications
          now={now}
          openThread={openThread}
          openProfile={openProfile}
        />
      )}
    </Stack>
  )
}

function TabButton({isActive, onClick, badge, children}) {
  return (
    <Button variant="tab" isActive={isActive} onClick={onClick}>
      <HStack spacing={2}>
        <Text as="span">{children}</Text>
        {badge > 0 && (
          <TodoVotingCountBadge>
            {badge > 99 ? '99+' : badge}
          </TodoVotingCountBadge>
        )}
      </HStack>
    </Button>
  )
}

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

  const postId = query.post !== undefined ? Number(query.post) : null
  // Opened from a profile, the inbox or the search: that item is shown and marked.
  const focusId = query.focus !== undefined ? Number(query.focus) : null
  const thread = React.useMemo(
    () => (postId === null ? null : feed.find(({id}) => id === postId)),
    [feed, postId]
  )
  const profileAddress = isSocialAddress(query.address)
    ? String(query.address).toLowerCase()
    : null
  const onPage = postId !== null || profileAddress !== null

  const state = scanOff
    ? {health: 'off', kind: 'scanOff'}
    : scanState(node, head, cache)

  let content
  if (postId !== null)
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
          {onPage ? (
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
            </HStack>
          )}
          {content}
        </Stack>
        {isInfoOpen && (
          <SocialInfoDialog
            state={state}
            onClose={() => setIsInfoOpen(false)}
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
