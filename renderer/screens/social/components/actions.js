/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, HStack, Stack, Text} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
} from '../../../shared/components/components'
import {SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {validTipAmount} from '../calls'
import {IdentityLabel, NameLink} from './identity'
import {TipDialog} from './send-dialogs'
import {MUTED} from './theme'
import {LIKE} from '../contract'
import {likeCount, replyCount, tipTotal} from '../feed'
import {timeAgo} from '../format'
import {displayName} from '../people'

/** A pill of the counters row; a button when it has an action, dimmed when the action is not available now. */
function Pill({onClick, label, isDisabled = false, children}) {
  const active = Boolean(onClick) && !isDisabled
  return (
    <Box
      as={onClick ? 'button' : 'span'}
      aria-label={label}
      title={label}
      disabled={onClick ? isDisabled : undefined}
      opacity={isDisabled ? 0.45 : 1}
      cursor={active ? 'pointer' : 'default'}
      borderWidth={1}
      borderColor="gray.100"
      rounded="full"
      px={3}
      py={1}
      fontSize="sm"
      fontWeight={500}
      color="brandGray.500"
      whiteSpace="nowrap"
      _hover={active ? {bg: 'gray.50'} : undefined}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation()
              if (active) onClick()
            }
          : undefined
      }
    >
      {children}
    </Box>
  )
}

/**
 * The counters and actions of a post, reply or comment, as the phone app's pills: ♡ likes (❤️ once liked, by the
 * scan or a like still on its way), 💬 answers (in a thread: answer it), 🪙 tip (or the iDNA tipped), and 👁 to see
 * who liked and tipped. Each action shows its fee before anything is sent. `onAnswers` opens the thread.
 */
export function ActionBar({node, onAnswers, onProfile, showAnswers = true}) {
  const {t} = useTranslation()
  const {me, names, targets, sending} = useSocial()
  const [isWhoOpen, setIsWhoOpen] = React.useState(false)
  const [isTipOpen, setIsTipOpen] = React.useState(false)
  const likes = likeCount(node)
  const liked =
    node.likeCalls.some(({author}) => author === me) ||
    sending.pendingLikes.has(node.id)
  const tips = tipTotal(node)
  const target = targets.get(node.id)
  const canAct = sending.canAct && Boolean(target)
  const {author: postAuthor} = node.call
  return (
    <HStack spacing={2} align="center">
      <Pill
        label={liked ? t('Liked') : t('Like')}
        isDisabled={!canAct || liked}
        onClick={() => sending.prepareLike(target, node.id)}
      >
        {liked ? LIKE : '♡'} {likes}
      </Pill>
      {showAnswers ? (
        <Pill label={t('Answers')} onClick={onAnswers}>
          💬 {replyCount(node)}
        </Pill>
      ) : (
        <Pill
          label={t('Answer')}
          isDisabled={!canAct}
          onClick={() => sending.startDraft(target, node.call)}
        >
          💬 {t('Reply')}
        </Pill>
      )}
      <Pill
        label={t('Tip')}
        isDisabled={!canAct || postAuthor === me}
        onClick={() => setIsTipOpen(true)}
      >
        🪙 {tips > 0 ? tips : t('Tip')}
      </Pill>
      <Box flex={1} />
      {(likes > 0 || node.tips.length > 0) && (
        <Pill
          label={t('Who liked and tipped')}
          onClick={() => setIsWhoOpen(true)}
        >
          👁
        </Pill>
      )}
      {isTipOpen && (
        <TipDialog
          name={displayName(postAuthor, names)}
          onClose={() => setIsTipOpen(false)}
          onNext={(amount) => {
            setIsTipOpen(false)
            sending.prepareTip(node.id, amount, displayName(postAuthor, names))
          }}
        />
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
