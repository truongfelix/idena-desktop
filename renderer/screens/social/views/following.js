/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Heading, HStack, Stack} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {person, sortedPeople} from '../people'
import {followedPeople} from '../lists'
import {topicList} from '../topics'
import {Chip} from '../components/chips'
import {TopicRow} from '../components/topic'
import {ContactRow} from './common'

const Tab = {People: 'people', Topics: 'topics'}

/**
 * The Following page (from the ⚙ next to Home's Following chip), as the phone app's: the people and the topics
 * followed, kept on this computer only. Its rows stay while the page is open, an unfollowed one with Follow, so a
 * click by mistake is undone at once. Export and import of these lists are in Social's ⓘ.
 */
export function FollowingView({now, openProfile, onRename}) {
  const {t} = useTranslation()
  const {people, followedTopics, feed} = useSocial()
  const [tab, setTab] = React.useState(Tab.People)
  // The rows shown: those followed when the page opened, and those followed now.
  const [openedPeople] = React.useState(() =>
    followedPeople(people).map(({address}) => address)
  )
  const [openedTopics] = React.useState(() => followedTopics)
  const followed = followedPeople(people)
  const shownPeople = sortedPeople(
    Object.fromEntries(
      [
        ...new Set([...openedPeople, ...followed.map(({address}) => address)]),
      ].map((address) => [address, people[address] || person(address)])
    )
  )
  const summaries = React.useMemo(
    () => new Map(topicList(feed).map((summary) => [summary.name, summary])),
    [feed]
  )
  const topicNames = [...new Set([...openedTopics, ...followedTopics])].sort()
  return (
    <Stack spacing={3} w="full">
      <Heading fontSize="xl" fontWeight={500}>
        {t('Following')}
      </Heading>
      <HStack spacing={2}>
        <Chip
          isSelected={tab === Tab.People}
          onClick={() => setTab(Tab.People)}
        >
          {t('People {{count}}', {count: followed.length})}
        </Chip>
        <Chip
          isSelected={tab === Tab.Topics}
          onClick={() => setTab(Tab.Topics)}
        >
          {t('Topics {{count}}', {count: followedTopics.length})}
        </Chip>
      </HStack>
      <SmallText>
        {t(
          'Their posts make your Following feed. Private: kept on this computer, never published.',
          {nsSeparator: '|'}
        )}
      </SmallText>
      {tab === Tab.People && shownPeople.length === 0 && (
        <SmallText>
          {t('You follow nobody yet: open a profile and select Follow.', {
            nsSeparator: '|',
          })}
        </SmallText>
      )}
      {tab === Tab.People &&
        shownPeople.map((contact) => (
          <ContactRow
            key={contact.address}
            contact={contact}
            onProfile={openProfile}
            onRename={onRename}
          />
        ))}
      {tab === Tab.Topics && topicNames.length === 0 && (
        <SmallText>
          {t(
            'You follow no topic yet: type r/ in the search, open a topic and select Follow.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {tab === Tab.Topics &&
        topicNames.map((name) => (
          <TopicRow
            key={name}
            name={name}
            summary={summaries.get(name)}
            now={now}
          />
        ))}
    </Stack>
  )
}
