/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Button,
  Divider,
  HStack,
  Stack,
  Text,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
} from '@chakra-ui/react'
import {Avatar, SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {
  displayName,
  shortAddress,
  MIN_SEARCH,
  followingFeed,
  searchSocial,
} from '../people'
import {Chip} from '../components/chips'
import {PostRow} from '../components/post'
import {FeedPeriod, FeedSort, sortFeed} from '../feed'
import {ContactRow, PAGE_SIZE, Rows, SearchField, ShowMore} from './common'

export function Home({now, openThread, openProfile, onRename}) {
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
