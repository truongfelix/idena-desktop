/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, Divider, Flex, Stack, Text} from '@chakra-ui/react'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {ipfsCid} from '../calls'
import {ActionBar} from './actions'
import {FullHeader, PostMedia, PostText} from './post'
import {LINK, MUTED} from './theme'
import {commentTree, descendants, replyCount} from '../feed'
import {timeAgo} from '../format'

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
function ThreadItem({node, children, depth, now, focusId, onProfile}) {
  const {t} = useTranslation()
  const {names} = useSocial()
  const [folded, setFolded] = React.useState(false)
  const ref = React.useRef()
  const isFocus = node.id === focusId
  React.useEffect(() => {
    if (isFocus) ref.current?.scrollIntoView({block: 'center'})
  }, [isFocus])
  const hidden = children.reduce(
    (sum, child) => sum + 1 + descendants(child),
    0
  )
  const rails = Math.min(depth, MAX_INDENT) + 1
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
            {node.call.hasMedia && !node.call.message
              ? t('🖼 Media')
              : textPreview(node.call.message, t)}
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
              avatarSize={depth === 0 ? 9 : 7}
              onClick={() => setFolded(true)}
            />
            <PostText message={node.call.message} />
            <PostMedia call={node.call} maxH="360px" />
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
  const ref = React.useRef()
  React.useEffect(() => {
    if (focusId === node.id) ref.current?.scrollIntoView({block: 'center'})
  }, [focusId, node.id])
  return (
    <Stack spacing={2} w="full">
      <Stack
        ref={ref}
        spacing={2}
        bg={focusId === node.id ? 'gray.50' : undefined}
        rounded="md"
      >
        <FullHeader
          address={node.call.author}
          time={node.call.time}
          now={now}
          onProfile={onProfile}
        />
        <PostText message={node.call.message} />
        <PostMedia call={node.call} maxH="360px" />
        <ActionBar node={node} onProfile={onProfile} showAnswers={false} />
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
        >
          {commentTree(reply.id, reply.replies)}
        </ThreadItem>
      ))}
    </Stack>
  )
}
