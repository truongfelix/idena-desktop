/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Button,
  Divider,
  HStack,
  IconButton,
  Stack,
  Text,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {
  displayName,
  shortAddress,
  MIN_SEARCH,
  followingFeed,
  searchSocial,
} from '../people'
import {Chip} from '../components/chips'
import {PostRow, TopicShown} from '../components/post'
import {TopicRow} from '../components/topic'
import {FeedPeriod, FeedSort, sortFeed} from '../feed'
import {TOPIC_PREFIX, topicList} from '../topics'
import {ContactRow, PAGE_SIZE, Rows, SearchField, ShowMore} from './common'
import {PersonAvatar} from '../components/profile-public'

export function Home({now, openThread, openProfile, onRename, openFollowing}) {
  const {t} = useTranslation()
  const {feed, people, names, epochStart, followedTopics} = useSocial()
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
      sortFeed(
        following ? followingFeed(feed, people, followedTopics) : feed,
        sort,
        {
          period,
          now,
          epochStart,
        }
      ),
    [epochStart, feed, followedTopics, following, now, people, period, sort]
  )
  // "r/…" lists the topics whose name holds the rest.
  const topicSearch = query.trim().startsWith(TOPIC_PREFIX)
  const searching = !topicSearch && searched.trim().length >= MIN_SEARCH
  const hits = React.useMemo(
    () => (searching ? searchSocial(feed, people, searched) : []),
    [feed, people, searched, searching]
  )
  const topics = React.useMemo(
    () => (topicSearch ? topicList(feed, query) : []),
    [feed, query, topicSearch]
  )
  const topicQuery = query.trim().slice(TOPIC_PREFIX.length)

  let empty = t('No posts found yet.')
  if (
    following &&
    !Object.values(people).some((p) => p.following) &&
    followedTopics.length === 0
  )
    empty = t(
      'You follow nobody and no topic yet. Open a profile or a topic and select Follow.'
    )
  else if (sort === FeedSort.Likes) empty = t('No liked post in this period.')
  else if (sort === FeedSort.Comments)
    empty = t('No post with answers in this period.')
  else if (sort === FeedSort.Tips) empty = t('No tipped post in this period.')

  return (
    <Stack spacing={3} w="full">
      <SearchField value={query} onChange={setQuery} />
      {topicSearch && (
        <Stack spacing={2}>
          {topics.length === 0 && (
            <SmallText>
              {topicQuery.trim() === ''
                ? t(
                    "No posts in a topic yet. Write one: the editor's Topic field puts a post in a topic.",
                    {nsSeparator: '|'}
                  )
                : t('No topic holds "{{query}}" in the posts read so far.', {
                    query: topicQuery.trim(),
                  })}
            </SmallText>
          )}
          {topics.map((topic) => (
            <TopicRow
              key={topic.name}
              name={topic.name}
              summary={topic}
              now={now}
            />
          ))}
        </Stack>
      )}
      {!topicSearch && searching && (
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
                  <PersonAvatar
                    address={hit.address}
                    boxSize={10}
                    rounded="md"
                  />
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
      )}
      {!topicSearch && !searching && (
        <>
          <HStack spacing={2} flexWrap="wrap">
            <Chip isSelected={!following} onClick={() => setFollowing(false)}>
              {t('Feed')}
            </Chip>
            <Chip isSelected={following} onClick={() => setFollowing(true)}>
              {t('Following')}
            </Chip>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t('People and topics followed')}
              title={t('People and topics followed')}
              icon={<Text>⚙</Text>}
              onClick={openFollowing}
            />
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
                topicShown={TopicShown.InsteadOfAuthor}
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
