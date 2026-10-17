/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, Divider, Flex, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {ipfsCid} from '../calls'
import {ActionBar} from './actions'
import {FullHeader, PostBody} from './post'
import {LINK, MUTED} from './theme'
import {commentTree, descendants, idKey, replyCount} from '../feed'
import {timeAgo} from '../format'
import {postTopic} from '../topics'
import {hidesText, leavesFeeds} from '../hiding'
import {TopicLine} from './topic'

/**
 * The author's picture in a thread: an answer to the post (depth 0) a little bigger than a comment under it. Steps
 * of the theme's size scale: one outside it (11) is read as pixels, an 11 px picture (B-100).
 */
export const answerAvatarSize = (depth) => (depth === 0 ? 10 : 9)

const RAIL = '18px'
const MAX_INDENT = 6

function Rails({count}) {
  return Array.from({length: count}, (_, i) => (
    <Box key={i} w={RAIL} flexShrink={0} position="relative">
      <Box
        position="absolute"
        top={0}
        bottom={0}
        left="8px"
        w="2px"
        bg="gray.100"
      />
    </Box>
  ))
}

function textPreview(message, t) {
  if (ipfsCid(message)) return t('Text on IPFS')
  return message.replace(/\s+/g, ' ').trim()
}

/** A reply or comment of a thread, with the comments under it; a click on its header or rails folds it. */
function ThreadItem({
  node,
  children,
  depth,
  now,
  focusId,
  onProfile,
  opAuthor,
}) {
  const {t} = useTranslation()
  const {names, hidden: hiding, me} = useSocial()
  // A muted author's reply, or one with a picture while pictures are hidden, starts folded (leavesFeeds).
  const [toggled, setFolded] = React.useState(null)
  const folded = toggled ?? leavesFeeds(hiding, node.call, me)
  const ref = React.useRef()
  const isFocus = idKey(node.id) === focusId
  React.useEffect(() => {
    if (isFocus) ref.current?.scrollIntoView({block: 'center'})
  }, [isFocus])
  const hidden = children.reduce(
    (sum, child) => sum + 1 + descendants(child),
    0
  )
  const rails = Math.min(depth, MAX_INDENT) + 1
  let preview = textPreview(node.call.message, t)
  if (hidesText(hiding, node.call, me)) preview = t('Hidden')
  else if (node.call.author !== me && hiding.muted.has(node.call.author))
    preview = t('Muted')
  else if (leavesFeeds(hiding, node.call, me))
    preview = t('🖼 A picture: hidden', {nsSeparator: '|'})
  else if (node.call.hasMedia && !node.call.message) preview = t('🖼 Media')
  return (
    <Stack spacing={0}>
      <Flex ref={ref} pt={depth === 0 ? 2 : 1}>
        <Flex onClick={() => setFolded(!folded)} cursor="pointer">
          <Rails count={rails} />
        </Flex>
        {folded ? (
          <Text
            fontSize="sm"
            noOfLines={1}
            cursor="pointer"
            onClick={() => setFolded(false)}
            py={1}
          >
            <Text as="span" fontWeight={500}>
              {displayName(node.call.author, names)}
            </Text>
            <Text as="span" color={MUTED}>{`  ·  ${timeAgo(
              node.call.time,
              now
            )}  ·  `}</Text>
            {preview}
            {hidden > 0 && (
              <Text as="span" color={LINK} fontWeight={500}>
                {`  +${hidden}`}
              </Text>
            )}
          </Text>
        ) : (
          <Stack
            spacing={1.5}
            flex={1}
            minW={0}
            bg={isFocus ? 'gray.50' : undefined}
            rounded="md"
            p={isFocus ? 1.5 : 0}
          >
            <FullHeader
              address={node.call.author}
              time={node.call.time}
              now={now}
              onProfile={onProfile}
              avatarSize={answerAvatarSize(depth)}
              onClick={() => setFolded(true)}
              isOp={node.call.author === opAuthor}
              call={node.call}
            />
            <PostBody call={node.call} maxH="360px" inThread />
            <ActionBar node={node} onProfile={onProfile} showAnswers={false} />
          </Stack>
        )}
      </Flex>
      {!folded &&
        children.map((child) => (
          <ThreadItem
            key={child.comment.id}
            node={child.comment}
            depth={depth + 1}
            now={now}
            focusId={focusId}
            onProfile={onProfile}
            opAuthor={opAuthor}
          >
            {child.children}
          </ThreadItem>
        ))}
    </Stack>
  )
}

/** A post with its replies, and under each reply its comments as a tree, as the phone app shows a thread. */
export function SocialThread({node, now, focusId, onProfile}) {
  const {t} = useTranslation()
  // The topic, then its author (who shows the time).
  const topic = postTopic(node)
  const ref = React.useRef()
  React.useEffect(() => {
    if (focusId === idKey(node.id))
      ref.current?.scrollIntoView({block: 'center'})
  }, [focusId, node.id])
  return (
    <Stack spacing={2} w="full">
      <Stack
        ref={ref}
        spacing={2}
        bg={focusId === idKey(node.id) ? 'gray.50' : undefined}
        rounded="md"
      >
        {topic !== null && <TopicLine name={topic} large />}
        <FullHeader
          address={node.call.author}
          time={node.call.time}
          now={now}
          onProfile={onProfile}
          call={node.call}
        />
        <PostBody call={node.call} maxH="360px" inThread />
        <ActionBar node={node} onProfile={onProfile} showAnswers={false} />
        {node.call.version && (
          <SmallText>
            {t(
              'From an earlier idena.social contract ({{version}}): read only.',
              {version: node.call.version, nsSeparator: '|'}
            )}
          </SmallText>
        )}
      </Stack>
      <Divider />
      <Text fontWeight={500}>
        {t('{{count}} answers', {count: replyCount(node)})}
      </Text>
      {node.replies.map((reply) => (
        <ThreadItem
          key={reply.id}
          node={reply}
          depth={0}
          now={now}
          focusId={focusId}
          onProfile={onProfile}
          opAuthor={node.call.author}
        >
          {commentTree(reply.id, reply.replies)}
        </ThreadItem>
      ))}
    </Stack>
  )
}
