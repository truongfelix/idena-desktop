/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {HStack, Stack, Text} from '@chakra-ui/react'
import {Avatar, SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {timeAgo} from '../format'
import {topicChannel} from '../topics'
import {Chip} from './chips'
import {LINK} from './theme'

/** Opens a topic's page from its tag or line on a post; null where they open nothing. */
export const OpenTopicContext = React.createContext(null)

const openProps = (open, name) =>
  open
    ? {
        cursor: 'pointer',
        onClick: (e) => {
          e.stopPropagation()
          open(name)
        },
      }
    : {}

/** The picture of a topic: the robot of "r/name" in a circle (a person's robot is a rounded square). */
export function TopicAvatar({name, boxSize = 6}) {
  return (
    <Avatar address={topicChannel(name)} boxSize={boxSize} rounded="full" />
  )
}

/** The tag of a post in a topic: "r/name"; a click opens the topic. */
export function TopicTag({name}) {
  const open = React.useContext(OpenTopicContext)
  return (
    <Text
      as="span"
      fontSize="sm"
      fontWeight={500}
      color={LINK}
      alignSelf="flex-start"
      {...openProps(open, name)}
    >
      {topicChannel(name)}
    </Text>
  )
}

/**
 * The topic picture of a TopicLine: steps of the theme's size scale (one outside it, 11, was read as pixels: an
 * 11 px picture on a thread, B-100).
 */
export const topicLineAvatarSize = (large) => (large ? 12 : 10)

/** A post's topic on top of its thread: its picture and "r/name"; a click opens the topic. `large`: the thread's line. */
export function TopicLine({name, large = false}) {
  const open = React.useContext(OpenTopicContext)
  return (
    <HStack spacing={large ? 2.5 : 2} align="center" {...openProps(open, name)}>
      <TopicAvatar name={name} boxSize={topicLineAvatarSize(large)} />
      <Text fontSize={large ? 'md' : 'sm'} fontWeight={600} noOfLines={1}>
        {topicChannel(name)}
      </Text>
    </HStack>
  )
}

/** Follow / Following for a topic. */
export function FollowTopicChip({name}) {
  const {t} = useTranslation()
  const {followedTopics, setTopicFollowed} = useSocial()
  const following = followedTopics.includes(name)
  return (
    <Chip
      isSelected={following}
      onClick={(e) => {
        e.stopPropagation()
        setTopicFollowed(name, !following)
      }}
    >
      {following ? t('Following') : t('Follow')}
    </Chip>
  )
}

/**
 * A topic in a list: its picture, r/name, its posts read and last activity (`summary`, from topicList; none when
 * no post of it was read), and Follow; a click opens it.
 */
export function TopicRow({name, summary, now}) {
  const {t} = useTranslation()
  const open = React.useContext(OpenTopicContext)
  return (
    <HStack
      spacing={3}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      {...openProps(open, name)}
    >
      <TopicAvatar name={name} boxSize={10} />
      <Stack spacing={0} flex={1} minW={0}>
        <Text fontWeight={500} noOfLines={1}>
          {topicChannel(name)}
        </Text>
        <SmallText>
          {summary
            ? t('{{count}} posts  ·  last activity {{ago}}', {
                count: summary.posts,
                ago: timeAgo(summary.lastTime, now),
              })
            : t('No post in the posts read so far')}
        </SmallText>
      </Stack>
      <FollowTopicChip name={name} />
    </HStack>
  )
}
