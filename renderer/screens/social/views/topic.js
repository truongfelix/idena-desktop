/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Heading, HStack, Stack} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {PostTarget} from '../contract'
import {topicChannel, topicFeed} from '../topics'
import {PostRow, TopicShown} from '../components/post'
import {FollowTopicChip, TopicAvatar} from '../components/topic'
import {PAGE_SIZE, Rows, ShowMore} from './common'
import {TrustButton, TrustLine} from '../components/profile-public'

/**
 * The page of a topic, as the phone app's: its Trust, Follow (its posts join the Following feed), Trust, "Post in
 * r/name", then its posts, newest first, without their topic.
 */
export function TopicView({name, now, openThread, openProfile}) {
  const {t} = useTranslation()
  const {feed, sending} = useSocial()
  const [shown, setShown] = React.useState(PAGE_SIZE)
  const posts = React.useMemo(() => topicFeed(feed, name), [feed, name])
  return (
    <Stack spacing={3} w="full">
      <HStack spacing={3}>
        <TopicAvatar name={name} boxSize={12} />
        <Heading fontSize="xl" fontWeight={500}>
          {topicChannel(name)}
        </Heading>
      </HStack>
      <SmallText>
        {t(
          '{{count}} posts in the posts read so far. Anyone can write in any topic; idena.social does not show topic posts.',
          {count: posts.length}
        )}
      </SmallText>
      <TrustLine target={topicChannel(name)} onProfile={openProfile} />
      <HStack spacing={2}>
        <FollowTopicChip name={name} />
        <TrustButton target={topicChannel(name)} />
        <SecondaryButton
          isDisabled={!sending.canAct}
          onClick={() => sending.startDraft(PostTarget.newPost(), null, name)}
        >
          {t('Post in {{topic}}', {topic: topicChannel(name)})}
        </SecondaryButton>
      </HStack>
      {posts.length === 0 && (
        <SmallText>{t('No posts in this topic yet.')}</SmallText>
      )}
      <Rows>
        {posts.slice(0, shown).map((node) => (
          <PostRow
            key={node.id}
            node={node}
            now={now}
            onOpen={() => openThread(node.id)}
            onProfile={openProfile}
            topicShown={TopicShown.Not}
          />
        ))}
      </Rows>
      <ShowMore
        shown={shown}
        total={posts.length}
        onMore={() => setShown(shown + PAGE_SIZE)}
      />
    </Stack>
  )
}
