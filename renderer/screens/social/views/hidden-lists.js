/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  HStack,
  IconButton,
  Input,
  Radio,
  RadioGroup,
  Stack,
  Text,
} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {displayName, person, sortedPeople} from '../people'
import {ipfsCid} from '../calls'
import {timeAgo} from '../format'
import {
  MAX_HIDDEN_WORD,
  MAX_HIDDEN_WORDS,
  PicturesMode,
  cleanHiddenWord,
  hiddenEntries,
  matchForm,
} from '../hiding'
import {topicChannel} from '../topics'
import {Chip} from '../components/chips'
import {OpenTopicContext, TopicAvatar} from '../components/topic'
import {PersonAvatar} from '../components/profile-public'

// The lists of Social settings for what is hidden on this computer, each entry undone there, as the phone app's
// (SocialBlocking.kt, SocialHiddenViews.kt, SocialMuting.kt): the accounts muted and blocked, the hidden words, the
// posts hidden one by one and the topics blocked; and the "Pictures in posts" setting.

function Row({onOpen, children}) {
  return (
    <HStack
      spacing={3}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor={onOpen ? 'pointer' : undefined}
      onClick={onOpen}
    >
      {children}
    </HStack>
  )
}

function UndoChip({onClick, children}) {
  return (
    <Chip
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </Chip>
  )
}

/** The accounts muted, each with Unmute; a click on one opens its profile. */
export function MutedList({openProfile}) {
  const {t} = useTranslation()
  const {people, names, setPerson} = useSocial()
  const muted = sortedPeople(people).filter((one) => one.muted)
  return (
    <>
      <SmallText>
        {t(
          'Their posts leave Home, Following and the topics, and their replies show folded in threads, on this computer only. Their likes, replies and tips on your posts still notify you, their messages still arrive, and their profile still lists their posts.'
        )}
      </SmallText>
      {muted.length === 0 && (
        <SmallText>
          {t(
            'Nobody is muted. To mute an account: ⋯ on its profile or on one of its posts.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {muted.map(({address}) => (
        <Row key={address} onOpen={() => openProfile(address)}>
          <PersonAvatar address={address} boxSize={10} rounded="md" />
          <Text fontWeight={500} flex={1} minW={0} noOfLines={1}>
            {displayName(address, names)}
          </Text>
          <UndoChip
            onClick={() =>
              setPerson({
                ...(people[address] || person(address)),
                muted: false,
              })
            }
          >
            {t('Unmute')}
          </UndoChip>
        </Row>
      ))}
    </>
  )
}

/** "Pictures in posts": Show, Click to show, or Hide posts with pictures (PicturesMode); one's own posts never change. */
export function PicturesSetting() {
  const {t} = useTranslation()
  const {picturesInPosts, setPicturesInPosts} = useSocial()
  const titles = {
    [PicturesMode.Show]: t('Show'),
    [PicturesMode.TapToShow]: t('Click to show'),
    [PicturesMode.Hide]: t('Hide posts with pictures'),
  }
  const lines = {
    [PicturesMode.Show]: t('Pictures show in the posts.'),
    [PicturesMode.TapToShow]: t(
      "A post's picture is one line until you click it in its thread: nothing is downloaded before.",
      {nsSeparator: '|'}
    ),
    [PicturesMode.Hide]: t(
      'Posts with a picture leave Home, Following and the topics; a reply with one shows folded in its thread.'
    ),
  }
  return (
    <Stack spacing={2}>
      <RadioGroup value={picturesInPosts} onChange={setPicturesInPosts}>
        <Stack spacing={2}>
          {Object.values(PicturesMode).map((mode) => (
            <Radio key={mode} value={mode}>
              {titles[mode]}
            </Radio>
          ))}
        </Stack>
      </RadioGroup>
      <SmallText>
        {`${lines[picturesInPosts]} ${t('Your own posts never change.')}`}
      </SmallText>
    </Stack>
  )
}

/** The accounts blocked, each with Unblock; a click on one opens its profile. */
export function BlockedList({openProfile}) {
  const {t} = useTranslation()
  const {people, names, setPerson} = useSocial()
  const blocked = sortedPeople(people).filter((one) => one.blocked)
  return (
    <>
      <SmallText>
        {t(
          'Their posts, replies, comments and messages are hidden on this computer only.'
        )}
      </SmallText>
      {blocked.length === 0 && (
        <SmallText>
          {t(
            'Nobody is blocked. To block an account: ⋯ on its profile or on one of its posts.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {blocked.map(({address}) => (
        <Row key={address} onOpen={() => openProfile(address)}>
          <PersonAvatar address={address} boxSize={10} rounded="md" />
          <Text fontWeight={500} flex={1} minW={0} noOfLines={1}>
            {displayName(address, names)}
          </Text>
          <UndoChip
            onClick={() =>
              setPerson({
                ...(people[address] || person(address)),
                blocked: false,
              })
            }
          >
            {t('Unblock')}
          </UndoChip>
        </Row>
      ))}
    </>
  )
}

/** The hidden words: a field to add one, and the list, each with ✕. */
export function HiddenWordsList() {
  const {t} = useTranslation()
  const {hiddenWords, setHiddenWords} = useSocial()
  const [text, setText] = React.useState('')
  const words = [...hiddenWords].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  )
  const isFull = words.length >= MAX_HIDDEN_WORDS
  const word = cleanHiddenWord(text)
  const add = () => {
    if (
      word &&
      !isFull &&
      !words.some((one) => matchForm(one) === matchForm(word))
    )
      setHiddenWords([...hiddenWords, word].sort())
    setText('')
  }
  return (
    <>
      <SmallText>
        {t(
          'A post with one of these words or phrases leaves the lists; a reply or comment with one shows folded in its thread. Whole words, capitals and accents ignored. Your own posts are never hidden.'
        )}
      </SmallText>
      <HStack spacing={2}>
        <Input
          value={text}
          maxLength={MAX_HIDDEN_WORD}
          placeholder={t('A word or phrase')}
          isDisabled={isFull}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <Chip isDisabled={!word || isFull} onClick={add}>
          {t('Add')}
        </Chip>
      </HStack>
      {isFull && (
        <SmallText>
          {t('The list is full ({{count}}).', {count: MAX_HIDDEN_WORDS})}
        </SmallText>
      )}
      <Stack spacing={1}>
        {words.map((one) => (
          <HStack key={one} spacing={2}>
            <Text flex={1}>{one}</Text>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t('Remove {{word}}', {word: one})}
              title={t('Remove {{word}}', {word: one})}
              icon={<Text>✕</Text>}
              onClick={() =>
                setHiddenWords(hiddenWords.filter((other) => other !== one))
              }
            />
          </HStack>
        ))}
      </Stack>
    </>
  )
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

/** The posts, replies and comments hidden, newest first, each with Show again; a click opens it in its thread. */
export function HiddenPostsList({now, openThread}) {
  const {t} = useTranslation()
  const {feed, hiddenPosts, names, setPostHidden} = useSocial()
  const entries = React.useMemo(
    () => hiddenEntries(feed, hiddenPosts),
    [feed, hiddenPosts]
  )
  const preview = ({call}) => {
    if (ipfsCid(call.message)) return t('Text on IPFS')
    if (!call.message) return t('🖼 Media')
    return call.message.replace(/\s+/g, ' ').trim()
  }
  return (
    <>
      <SmallText>
        {t(
          'Posts, replies and comments you hid: they leave the lists, and show folded in their thread.',
          {nsSeparator: '|'}
        )}
      </SmallText>
      {entries.length === 0 && (
        <SmallText>
          {t('Nothing is hidden. To hide a post: ⋯ at its top right.', {
            nsSeparator: '|',
          })}
        </SmallText>
      )}
      {entries.map(({hash, threadId, node}) => (
        <Row
          key={hash}
          onOpen={node ? () => openThread(threadId, node.id) : undefined}
        >
          <Stack spacing={0} flex={1} minW={0}>
            <Text fontWeight={500} noOfLines={1}>
              {node
                ? `${displayName(node.call.author, names)}  ·  ${timeAgo(
                    node.call.time,
                    now
                  )}`
                : shortHash(hash)}
            </Text>
            <SmallText noOfLines={1}>
              {node ? preview(node) : t('Not in the posts read so far.')}
            </SmallText>
          </Stack>
          <UndoChip onClick={() => setPostHidden(hash, false)}>
            {t('Show again')}
          </UndoChip>
        </Row>
      ))}
    </>
  )
}

/** The topics blocked, each with Unblock; a click opens the topic's page. */
export function BlockedTopicsList() {
  const {t} = useTranslation()
  const {blockedTopics, setTopicBlocked} = useSocial()
  const open = React.useContext(OpenTopicContext)
  return (
    <>
      <SmallText>
        {t('Their posts are hidden on this computer only.')}
      </SmallText>
      {blockedTopics.length === 0 && (
        <SmallText>
          {t(
            'No topic is blocked. To block one: Block on its page, or ⋯ on one of its posts.',
            {nsSeparator: '|'}
          )}
        </SmallText>
      )}
      {blockedTopics.map((name) => (
        <Row key={name} onOpen={open ? () => open(name) : undefined}>
          <TopicAvatar name={name} boxSize={10} />
          <Text fontWeight={500} flex={1} minW={0} noOfLines={1}>
            {topicChannel(name)}
          </Text>
          <UndoChip onClick={() => setTopicBlocked(name, false)}>
            {t('Unblock')}
          </UndoChip>
        </Row>
      ))}
    </>
  )
}
