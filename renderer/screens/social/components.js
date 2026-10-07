/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Button,
  Divider,
  Flex,
  HStack,
  Image,
  Input,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react'
import {
  Avatar,
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {useIpfsContent, useSocialIdentity} from './hooks'
import {useSocial} from './provider'
import {cleanName, displayName, person, shortAddress} from './people'
import {
  LIKE,
  SOCIAL_FIRST_BLOCK,
  ActivityKind,
  NotifyKind,
  commentTree,
  descendants,
  historyDone,
  identityColor,
  identityStatus,
  ipfsCid,
  likeCount,
  replyCount,
  scannedShare,
  timeAgo,
  tipTotal,
  validTipAmount,
} from './utils'

const MUTED = 'muted'
const LINK = 'blue.500'

/** The dot colors of the phone app's status. */
export const healthColor = {
  good: '#2E9D4A',
  warn: '#F08C00',
  bad: '#D93025',
  off: 'gray.300',
}

export function StatusDot({health, size = 2.5}) {
  return (
    <Box
      w={size}
      h={size}
      rounded="full"
      bg={healthColor[health]}
      flexShrink={0}
    />
  )
}

/** A label of the scan's state: {health, kind, behind, share}. */
export function useScanLabel(state) {
  const {t} = useTranslation()
  return {
    noNode: t('The node does not answer'),
    noPeers: t('No peers'),
    validation: t('Paused during the validation'),
    syncing: t('The node is syncing'),
    starting: t('Starting the scan'),
    scanOff: t('Scan off'),
    behind: t('{{count}} blocks behind', {count: state.behind}),
    history: t('Reading older posts ({{percent}}%)', {
      percent: Math.floor((state.share || 0) * 100),
    }),
    upToDate: t('Up to date'),
  }[state.kind]
}

/** An address as a link to its profile, shown by its contact name if it has one. */
export function NameLink({address, onProfile, ...props}) {
  const {names} = useSocial()
  return (
    <Text
      as="button"
      color={LINK}
      fontWeight={500}
      textAlign="left"
      onClick={(e) => {
        e.stopPropagation()
        onProfile(address)
      }}
      {...props}
    >
      {displayName(address, names)}
    </Text>
  )
}

/** An identity's state, in its color ("Human"), with the age when `withAge` ("Human · age 12"). */
export function IdentityLabel({address, withAge = false, ...props}) {
  const {t} = useTranslation()
  const {data: identity} = useSocialIdentity(address)
  if (!identity) return null
  const status = identityStatus(identity.state)
  const label =
    withAge && identity.age > 0 && status !== 'Not validated'
      ? `${t(status)} · ${t('age {{age}}', {age: identity.age})}`
      : t(status)
  return (
    <Text
      as="span"
      fontWeight={500}
      color={identityColor(identity.state) || MUTED}
      {...props}
    >
      {label}
    </Text>
  )
}

const textDecoder = new TextDecoder()

/** A post's text, from IPFS when idena.social stored it there; `lines` clamps it. */
function PostText({message, lines}) {
  const {t} = useTranslation()
  const cid = ipfsCid(message)
  const {data, isLoading, isError, refetch} = useIpfsContent(cid)
  if (cid) {
    if (isLoading)
      return (
        <SmallText>
          {t('Loading the text from IPFS through the node…')}
        </SmallText>
      )
    if (isError || data === null)
      return (
        <HStack spacing={2}>
          <SmallText>
            {t('No longer available on IPFS: no node has it.', {
              nsSeparator: '|',
            })}
          </SmallText>
          <Button
            variant="link"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              refetch()
            }}
          >
            {t('Retry')}
          </Button>
        </HStack>
      )
  }
  const shown = cid ? textDecoder.decode(data) : message
  if (!shown) return null
  return (
    <Text
      fontSize="md"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      noOfLines={lines}
    >
      {shown}
    </Text>
  )
}

function MediaElement({src, type, maxH}) {
  if (type.startsWith('image/'))
    return (
      <Image
        src={src}
        alt=""
        maxH={maxH}
        maxW="full"
        objectFit="contain"
        rounded="lg"
        alignSelf="flex-start"
      />
    )
  return null
}

function IpfsMedia({cid, type, maxH}) {
  const {t} = useTranslation()
  const {data, isLoading, isError, refetch} = useIpfsContent(cid)
  const url = React.useMemo(
    () => (data ? URL.createObjectURL(new Blob([data], {type})) : null),
    [data, type]
  )
  React.useEffect(() => () => url && URL.revokeObjectURL(url), [url])
  if (isLoading)
    return (
      <SmallText>
        {t('Loading the image from IPFS through the node…')}
      </SmallText>
    )
  if (isError || !url)
    return (
      <HStack spacing={2}>
        <SmallText>
          {t('No longer available on IPFS: no node has it.', {
            nsSeparator: '|',
          })}
        </SmallText>
        <Button
          variant="link"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            refetch()
          }}
        >
          {t('Retry')}
        </Button>
      </HStack>
    )
  return <MediaElement src={url} type={type} maxH={maxH} />
}

/** A post's first media: inline (base64) or on IPFS. */
function PostMedia({call: {hasMedia, media, mediaType}, maxH}) {
  const {t} = useTranslation()
  if (!hasMedia) return null
  const type = String(mediaType).toLowerCase()
  if (type === 'image/svg+xml')
    return <SmallText>{t('🖼 SVG image, not shown here.')}</SmallText>
  if (type.startsWith('video/') || type.startsWith('audio/'))
    return <SmallText>{t('🎞 Video or audio, not shown here.')}</SmallText>
  if (!type.startsWith('image/') || !media)
    return <SmallText>{t('🖼 Media')}</SmallText>
  const cid = ipfsCid(media)
  if (cid) return <IpfsMedia cid={cid} type={type} maxH={maxH} />
  if (media.startsWith('ipfs://')) return null
  return (
    <MediaElement
      src={`data:${type};base64,${media}`}
      type={type}
      maxH={maxH}
    />
  )
}

/** A pill of the counters row; a button when it has an action. */
function Pill({onClick, label, children}) {
  return (
    <Box
      as={onClick ? 'button' : 'span'}
      aria-label={label}
      title={label}
      borderWidth={1}
      borderColor="gray.100"
      rounded="full"
      px={3}
      py={1}
      fontSize="sm"
      fontWeight={500}
      color="brandGray.500"
      whiteSpace="nowrap"
      _hover={onClick ? {bg: 'gray.50'} : undefined}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation()
              onClick()
            }
          : undefined
      }
    >
      {children}
    </Box>
  )
}

/**
 * The counters of a post, reply or comment, as the phone app's pills: ♡ (❤️ once liked) likes, 💬 answers, 🪙
 * iDNA tipped, and 👁 to see who liked and tipped. `onAnswers` opens the thread.
 */
export function ActionBar({node, onAnswers, onProfile, showAnswers = true}) {
  const {t} = useTranslation()
  const {me} = useSocial()
  const [isWhoOpen, setIsWhoOpen] = React.useState(false)
  const likes = likeCount(node)
  const liked = node.likeCalls.some(({author}) => author === me)
  const tips = tipTotal(node)
  return (
    <HStack spacing={2} align="center">
      <Pill label={t('Likes')}>
        {liked ? LIKE : '♡'} {likes}
      </Pill>
      {showAnswers && (
        <Pill label={t('Answers')} onClick={onAnswers}>
          💬 {replyCount(node)}
        </Pill>
      )}
      {tips > 0 && <Pill label={t('Tips')}>🪙 {tips}</Pill>}
      <Box flex={1} />
      {(likes > 0 || node.tips.length > 0) && (
        <Pill
          label={t('Who liked and tipped')}
          onClick={() => setIsWhoOpen(true)}
        >
          👁
        </Pill>
      )}
      {isWhoOpen && (
        <WhoDialog
          node={node}
          onClose={() => setIsWhoOpen(false)}
          onProfile={(address) => {
            setIsWhoOpen(false)
            onProfile(address)
          }}
        />
      )}
    </HStack>
  )
}

function WhoLine({address, extra, time, onProfile}) {
  const now = Math.floor(Date.now() / 1000)
  return (
    <Text fontSize="md">
      <NameLink address={address} onProfile={onProfile} />
      {'  ·  '}
      <IdentityLabel address={address} withAge />
      {extra && `  ·  ${extra}`}
      <Text as="span" color={MUTED}>{`  ·  ${timeAgo(time, now)}`}</Text>
    </Text>
  )
}

/** Who liked and who tipped, newest first, as the phone app's 👁 dialog. */
function WhoDialog({node, onClose, onProfile}) {
  const {t} = useTranslation()
  const likes = [...node.likeCalls].reverse()
  const tips = [...node.tips].reverse()
  const total = tipTotal(node)
  return (
    <Dialog title={t('Likes and tips')} isOpen onClose={onClose} size="md">
      <DialogBody>
        <Stack spacing={2} maxH="420px" overflowY="auto">
          {likes.length > 0 && (
            <Text fontWeight={500}>
              {LIKE} {t('{{count}} likes', {count: likes.length})}
            </Text>
          )}
          {likes.map((like) => (
            <WhoLine
              key={like.hash}
              address={like.author}
              time={like.time}
              onProfile={onProfile}
            />
          ))}
          {tips.length > 0 && (
            <Text fontWeight={500} pt={2}>
              🪙{' '}
              {t('{{total}} iDNA in {{count}} tips', {
                total,
                count: tips.length,
              })}
            </Text>
          )}
          {tips.map((tip) => (
            <WhoLine
              key={tip.hash}
              address={tip.from}
              extra={`${validTipAmount(tip)} iDNA`}
              time={tip.time}
              onProfile={onProfile}
            />
          ))}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * A post of the feed, as the phone app's rows: avatar, name, identity state in its color, time ago on one line,
 * the text on 3 lines, the image, then the counters. A click opens the thread.
 */
export function PostRow({node, now, onOpen, onProfile}) {
  const {call} = node
  return (
    <Stack spacing={1.5} py={3} w="full">
      <Stack spacing={1} cursor="pointer" onClick={onOpen}>
        <HStack spacing={2} align="center">
          <Avatar
            address={call.author}
            boxSize={6}
            rounded="md"
            cursor="pointer"
            onClick={(e) => {
              e.stopPropagation()
              onProfile(call.author)
            }}
          />
          <Text fontSize="sm" noOfLines={1}>
            <NameLink address={call.author} onProfile={onProfile} />
            <Text as="span" color={MUTED}>
              {'  ·  '}
            </Text>
            <IdentityLabel address={call.author} fontSize="sm" />
            <Text as="span" color={MUTED}>{`  ·  ${timeAgo(
              call.time,
              now
            )}`}</Text>
          </Text>
        </HStack>
        <PostText message={call.message} lines={3} />
        <PostMedia call={call} maxH="220px" />
      </Stack>
      <ActionBar node={node} onAnswers={onOpen} onProfile={onProfile} />
    </Stack>
  )
}

/** The header of a thread item or a profile card: avatar, name and time, then the identity with its age. */
function FullHeader({address, time, now, onProfile, avatarSize = 9, onClick}) {
  return (
    <HStack
      spacing={2.5}
      align="center"
      onClick={onClick}
      cursor={onClick ? 'pointer' : undefined}
    >
      <Avatar
        address={address}
        boxSize={avatarSize}
        rounded="md"
        cursor="pointer"
        onClick={(e) => {
          e.stopPropagation()
          onProfile(address)
        }}
      />
      <Stack spacing={0} flex={1} minW={0}>
        <HStack spacing={2} justify="space-between">
          <NameLink address={address} onProfile={onProfile} noOfLines={1} />
          <SmallText flexShrink={0}>{timeAgo(time, now)}</SmallText>
        </HStack>
        <IdentityLabel address={address} withAge fontSize="sm" />
      </Stack>
    </HStack>
  )
}

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

/** The dialog to name (or rename) an address, as the phone app's. */
export function NameDialog({address, onClose}) {
  const {t} = useTranslation()
  const {people, setPerson} = useSocial()
  const current = people[address] || person(address)
  const [name, setName] = React.useState(current.name)
  const cleaned = cleanName(name)
  const removes = cleaned === '' && current.name !== ''
  return (
    <Dialog
      title={
        current.name
          ? t('Rename {{name}}', {name: current.name})
          : t('Name {{address}}', {address: shortAddress(address)})
      }
      isOpen
      onClose={onClose}
    >
      <DialogBody>
        <Stack spacing={3}>
          <Text color={MUTED}>
            {t(
              'Shown instead of the address in the Social tab. It stays on this computer: nobody else sees it.',
              {nsSeparator: '|'}
            )}
          </Text>
          <Input
            autoFocus
            value={name}
            placeholder={t('Name')}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          isDisabled={cleaned === current.name}
          onClick={() => {
            setPerson({...current, name: cleaned})
            onClose()
          }}
        >
          {removes ? t('Remove the name') : t('Save')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** A chip as the phone's FilterChip: selected or not. */
export function Chip({isSelected, onClick, children, ...props}) {
  return (
    <Button
      size="sm"
      h={8}
      px={3}
      rounded="md"
      borderWidth={1}
      borderColor={isSelected ? 'blue.500' : 'gray.100'}
      bg={isSelected ? 'blue.012' : 'transparent'}
      color={isSelected ? 'blue.500' : 'brandGray.500'}
      fontWeight={500}
      _hover={{bg: isSelected ? 'blue.012' : 'gray.50'}}
      _active={{bg: 'gray.50'}}
      onClick={onClick}
      {...props}
    >
      {isSelected && '✓ '}
      {children}
    </Button>
  )
}

/** The Follow chip of an address: "Follow", or "Following" once selected. */
export function FollowChip({address}) {
  const {t} = useTranslation()
  const {people, setPerson} = useSocial()
  const current = people[address] || person(address)
  return (
    <Chip
      isSelected={current.following}
      onClick={(e) => {
        e.stopPropagation()
        setPerson({...current, following: !current.following})
      }}
    >
      {current.following ? t('Following') : t('Follow')}
    </Chip>
  )
}

/** The status details: the node, the scan, the history, and the scan switch, as the phone app's ⓘ dialog. */
export function SocialInfoDialog({state, onClose}) {
  const {t} = useTranslation()
  const label = useScanLabel(state)
  const {cache, head, node, feed, scanOff, setScanOff} = useSocial()
  const posts = feed.length
  return (
    <Dialog
      title={
        <HStack spacing={2}>
          <StatusDot health={state.health} size={3.5} />
          <Text>
            {label}
            {node?.peers > 0 &&
              ` · ${t('{{count}} peers', {count: node.peers})}`}
          </Text>
        </HStack>
      }
      isOpen
      onClose={onClose}
      size="md"
    >
      <DialogBody>
        <Stack spacing={2} fontSize="md">
          <Text>
            {node
              ? t('Node at block {{block}}, {{count}} peers.', {
                  block: head?.toLocaleString() ?? '…',
                  count: node.peers ?? 0,
                })
              : t('The node does not answer')}
          </Text>
          {cache && (
            <Text>
              {t('Newest block read {{high}}, the node at {{head}}.', {
                high: cache.high.toLocaleString(),
                head: head?.toLocaleString() ?? '…',
              })}
            </Text>
          )}
          {cache && (
            <Text>
              {historyDone(cache)
                ? t(
                    'History complete since block {{first}}, {{count}} posts.',
                    {first: SOCIAL_FIRST_BLOCK.toLocaleString(), count: posts}
                  )
                : t(
                    'History {{percent}}% read, back to block {{low}}, {{count}} posts.',
                    {
                      percent: Math.floor(scannedShare(cache) * 100),
                      low: cache.low.toLocaleString(),
                      count: posts,
                    }
                  )}
            </Text>
          )}
          <Divider />
          <HStack spacing={3}>
            <Switch
              isChecked={!scanOff}
              onChange={() => setScanOff(!scanOff)}
            />
            <Text fontWeight={500}>{t('Scan blocks')}</Text>
          </HStack>
          <SmallText>
            {t(
              'On, the app reads the new blocks, then the older posts once, then each new block (also with this page closed, once the history is read). Off, nothing is read and the posts already read stay.'
            )}
          </SmallText>
          <Divider />
          {[
            ['good', t('Up to date')],
            ['warn', t('Behind or reading older posts')],
            ['bad', t('No node or no peers')],
            ['off', t('Off, or paused during a validation')],
          ].map(([health, text]) => (
            <HStack key={health} spacing={2}>
              <StatusDot health={health} />
              <SmallText>{text}</SmallText>
            </HStack>
          ))}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Close')}</SecondaryButton>
      </DialogFooter>
    </Dialog>
  )
}

/** A notification of the Inbox: who did what on which post, and the answer. */
export function ActivityCard({item, now, isNew, onOpen, onProfile}) {
  const {t} = useTranslation()
  const action = {
    [ActivityKind.Like]: t('liked your post'),
    [ActivityKind.Reply]: t('replied to your post'),
    [ActivityKind.Comment]: t('commented on your post'),
    [ActivityKind.Tip]: t('tipped you {{amount}} iDNA for your post', {
      amount: item.amount,
    }),
  }[item.kind]
  return (
    <Stack
      spacing={1.5}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={onOpen}
    >
      {isNew && (
        <Text fontSize="sm" fontWeight={500} color={LINK}>
          ● {t('New')}
        </Text>
      )}
      <HStack spacing={2.5} align="center">
        <Avatar address={item.actor} boxSize={8} rounded="md" />
        <Text fontSize="md">
          <NameLink address={item.actor} onProfile={onProfile} /> {action}
          <Text as="span" color={MUTED}>{`  ·  ${timeAgo(
            item.time,
            now
          )}`}</Text>
        </Text>
      </HStack>
      <Box color={MUTED}>
        <PostText message={item.what.message} lines={2} />
      </Box>
      {item.answer && (
        <>
          <Divider />
          <PostText message={item.answer.message} lines={4} />
        </>
      )}
    </Stack>
  )
}

export const notifyKindLabels = (t) => ({
  [NotifyKind.Likes]: t('Likes'),
  [NotifyKind.Comments]: t('Comments'),
  [NotifyKind.Tips]: t('Tips'),
})

/** One entry of a profile list as the phone's card: what it answered, liked or tipped, then the post. */
export function ProfileItemCard({item, tab, now, onOpen, onProfile}) {
  const {t} = useTranslation()
  const {names} = useSocial()
  const {node, parent, like, tip} = item
  let context = null
  if (like)
    context = `${LIKE} ${t('Liked {{name}}', {
      name: displayName(node.call.author, names),
    })}  ·  ${timeAgo(like.time, now)}`
  else if (tip)
    context = `🪙 ${t('Tipped {{amount}} iDNA to {{name}}', {
      amount: validTipAmount(tip),
      name: displayName(node.call.author, names),
    })}  ·  ${timeAgo(tip.time, now)}`
  else if (parent)
    context =
      tab === 'replies'
        ? t('Reply to {{name}}', {name: displayName(parent.author, names)})
        : t('Comment on {{name}}', {name: displayName(parent.author, names)})
  const showHeader = !like && !tip
  return (
    <Stack
      spacing={1.5}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={onOpen}
    >
      {context && <SmallText>{context}</SmallText>}
      {parent && showHeader && (
        <>
          <Box color={MUTED}>
            <PostText message={parent.message} lines={2} />
          </Box>
          <Divider />
        </>
      )}
      {showHeader && (
        <FullHeader
          address={node.call.author}
          time={node.call.time}
          now={now}
          onProfile={onProfile}
        />
      )}
      <PostText message={node.call.message} lines={showHeader ? 6 : 4} />
      {tab === 'media' && <PostMedia call={node.call} maxH="360px" />}
      <SmallText>
        {`♡ ${likeCount(node)}  ·  💬 ${replyCount(node)}  ·  🪙 ${tipTotal(
          node
        )}`}
      </SmallText>
    </Stack>
  )
}
