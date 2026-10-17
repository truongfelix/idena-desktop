/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Divider, HStack, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {displayName, shortAddress, MIN_SEARCH, searchSocial} from '../people'
import {PostRow} from '../components/post'
import {TopicRow} from '../components/topic'
import {FeedSort} from '../feed'
import {feedPosts} from '../hiding'
import {applyFeedFilter, isFollowed} from '../feed-filter'
import {FeedFilterButton, FeedFilterLine} from '../components/feed-filter'
import {TOPIC_PREFIX, topicList} from '../topics'
import {ContactRow, PAGE_SIZE, Rows, SearchField, ShowMore} from './common'
import {PersonAvatar} from '../components/profile-public'

/**
 * The Feed, as the phone app's: the search bar with the feed's filter at its end (feed-filter.js; the line under it
 * names a filter that is not the default), then the posts. `openList` opens the people or the topics followed.
 */
export function Home({now, openThread, openProfile, onRename, openList}) {
  const {t} = useTranslation()
  // The feed as shown: without what is blocked or hidden (hiding.js).
  const {
    shownFeed: feed,
    me,
    hidden,
    people,
    names,
    epochStart,
    followedTopics,
    feedFilter: filter,
    setFeedFilter,
  } = useSocial()
  const [query, setQuery] = React.useState('')
  const [searched, setSearched] = React.useState('')
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    const timer = setTimeout(() => setSearched(query), 250)
    return () => clearTimeout(timer)
  }, [query])
  React.useEffect(() => setShown(PAGE_SIZE), [filter])

  const posts = React.useMemo(
    () =>
      // Muted accounts and, at Hide, posts with a picture leave the feeds only: the search still finds them.
      applyFeedFilter(feedPosts(feed, hidden, me), filter, {
        people,
        followedTopics,
        now,
        epochStart,
      }),
    [epochStart, feed, filter, followedTopics, hidden, me, now, people]
  )
  const {sort} = filter
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
    isFollowed(filter) &&
    !(filter.people && Object.values(people).some((p) => p.following)) &&
    !(filter.topics && followedTopics.length > 0)
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
      <SearchField
        value={query}
        onChange={setQuery}
        trailing={
          <FeedFilterButton
            filter={filter}
            onChange={setFeedFilter}
            peopleCount={
              Object.values(people).filter((one) => one.following).length
            }
            topicsCount={followedTopics.length}
            openList={openList}
          />
        }
      />
      {!topicSearch && !searching && (
        <FeedFilterLine filter={filter} onChange={setFeedFilter} />
      )}
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
