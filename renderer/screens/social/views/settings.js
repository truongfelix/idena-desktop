/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {Heading, HStack, Stack} from '@chakra-ui/react'
import {useSocial} from '../provider'
import {followedPeople} from '../lists'
import {Chip} from '../components/chips'
import {FollowedPeople, FollowedTopics} from './following'
import {
  BlockedList,
  BlockedTopicsList,
  HiddenPostsList,
  HiddenWordsList,
  MutedList,
  PicturesSetting,
} from './hidden-lists'

export const SettingsTab = {
  People: 'people',
  Topics: 'topics',
  Muted: 'muted',
  Blocked: 'blocked',
  Words: 'words',
  Posts: 'posts',
  BlockedTopics: 'blocked-topics',
  Pictures: 'pictures',
}

/**
 * Social settings (the ⚙ next to Home's Following chip), as the phone app's: the people and the topics followed,
 * the accounts muted and blocked, the hidden words, the posts hidden and the topics blocked, all kept on this
 * computer only, each undone here, and "Pictures in posts"; `tab` is the one shown. Export and import of the lists
 * are in Social's ⓘ.
 */
export function SocialSettingsView({
  tab,
  setTab,
  now,
  openProfile,
  openThread,
  onRename,
}) {
  const {t} = useTranslation()
  const {people, followedTopics, hiddenWords, hiddenPosts, blockedTopics} =
    useSocial()
  const blocked = Object.values(people).filter((one) => one.blocked).length
  const muted = Object.values(people).filter((one) => one.muted).length
  const tabs = [
    [
      SettingsTab.People,
      t('People {{count}}', {count: followedPeople(people).length}),
    ],
    [SettingsTab.Topics, t('Topics {{count}}', {count: followedTopics.length})],
    [SettingsTab.Muted, t('Muted {{count}}', {count: muted})],
    [SettingsTab.Blocked, t('Blocked {{count}}', {count: blocked})],
    [
      SettingsTab.Words,
      t('Hidden words {{count}}', {count: hiddenWords.length}),
    ],
    [
      SettingsTab.Posts,
      t('Hidden posts {{count}}', {count: hiddenPosts.length}),
    ],
    [
      SettingsTab.BlockedTopics,
      t('Blocked topics {{count}}', {count: blockedTopics.length}),
    ],
    [SettingsTab.Pictures, t('Pictures in posts')],
  ]
  return (
    <Stack spacing={3} w="full">
      <Heading fontSize="xl" fontWeight={500}>
        {t('Social settings')}
      </Heading>
      <HStack spacing={2} flexWrap="wrap" rowGap={2}>
        {tabs.map(([value, label]) => (
          <Chip
            key={value}
            isSelected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </Chip>
        ))}
      </HStack>
      {tab === SettingsTab.People && (
        <FollowedPeople openProfile={openProfile} onRename={onRename} />
      )}
      {tab === SettingsTab.Topics && <FollowedTopics now={now} />}
      {tab === SettingsTab.Muted && <MutedList openProfile={openProfile} />}
      {tab === SettingsTab.Blocked && <BlockedList openProfile={openProfile} />}
      {tab === SettingsTab.Words && <HiddenWordsList />}
      {tab === SettingsTab.Posts && (
        <HiddenPostsList now={now} openThread={openThread} />
      )}
      {tab === SettingsTab.BlockedTopics && <BlockedTopicsList />}
      {tab === SettingsTab.Pictures && <PicturesSetting />}
    </Stack>
  )
}
