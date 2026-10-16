/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {person, sortedPeople} from '../people'
import {followedPeople} from '../lists'
import {topicList} from '../topics'
import {TopicRow} from '../components/topic'
import {ContactRow} from './common'

// The people and the topics followed, two tabs of Social settings (settings.js), as the phone app's: kept on this
// computer only. Their rows stay while the tab is open, an unfollowed one with Follow, so a click by mistake is
// undone at once.

function FollowingNote() {
  const {t} = useTranslation()
  return (
    <SmallText>
      {t(
        'Their posts make your Following feed. Private: kept on this computer, never published.',
        {nsSeparator: '|'}
      )}
    </SmallText>
  )
}

export function FollowedPeople({openProfile, onRename}) {
  const {t} = useTranslation()
  const {people} = useSocial()
  // The rows shown: those followed when the tab opened, and those followed now.
  const [opened] = React.useState(() =>
    followedPeople(people).map(({address}) => address)
  )
  const shown = sortedPeople(
    Object.fromEntries(
      [
        ...new Set([
          ...opened,
          ...followedPeople(people).map(({address}) => address),
        ]),
      ].map((address) => [address, people[address] || person(address)])
    )
  )
  return (
    <>
      <FollowingNote />
      {shown.length === 0 && (
        <SmallText>
          {t('You follow nobody yet: open a profile and select Follow.', {
            nsSeparator: '|',
          })}
        </SmallText>
      )}
      {shown.map((contact) => (
        <ContactRow
          key={contact.address}
          contact={contact}
          onProfile={openProfile}
          onRename={onRename}
        />
      ))}
    </>
  )
}

export function FollowedTopics({now}) {
  const {t} = useTranslation()
  const {followedTopics, feed} = useSocial()
  const [opened] = React.useState(() => followedTopics)
  const summaries = React.useMemo(
    () => new Map(topicList(feed).map((summary) => [summary.name, summary])),
    [feed]
  )
  const names = [...new Set([...opened, ...followedTopics])].sort()
  return (
    <>
      <FollowingNote />
      {names.length === 0 && (
        <SmallText>
          {t(
            'You follow no topic yet: type r/ in the search, open a topic and select Follow.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {names.map((name) => (
        <TopicRow
          key={name}
          name={name}
          summary={summaries.get(name)}
          now={now}
        />
      ))}
    </>
  )
}
