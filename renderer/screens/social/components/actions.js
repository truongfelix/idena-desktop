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
import {timeAgo, tipText} from '../format'
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
 * A pill of two parts: the action (`onAction`, dimmed when `isDisabled`) and its count, which opens who did it
 * (`onCount`, a button only while the count is not zero).
 */
function SplitPill({label, countLabel, isDisabled, onAction, count, onCount}) {
  const hasCount = Boolean(onCount)
  const part = (active) => ({
    px: 3,
    py: 1,
    cursor: active ? 'pointer' : 'default',
    _hover: active ? {bg: 'gray.50'} : undefined,
  })
  return (
    <HStack
      spacing={0}
      borderWidth={1}
      borderColor="gray.100"
      rounded="full"
      overflow="hidden"
      fontSize="sm"
      fontWeight={500}
      color="brandGray.500"
      whiteSpace="nowrap"
    >
      <Box
        as="button"
        aria-label={label}
        title={label}
        disabled={isDisabled}
        opacity={isDisabled ? 0.45 : 1}
        {...part(!isDisabled)}
        onClick={(e) => {
          e.stopPropagation()
          if (!isDisabled) onAction()
        }}
      >
        {count.action}
      </Box>
      {count.text !== null && (
        <Box
          as={hasCount ? 'button' : 'span'}
          aria-label={hasCount ? countLabel : undefined}
          title={hasCount ? countLabel : undefined}
          borderLeftWidth={1}
          borderColor="gray.100"
          {...part(hasCount)}
          onClick={
            hasCount
              ? (e) => {
                  e.stopPropagation()
                  onCount()
                }
              : undefined
          }
        >
          {count.text}
        </Box>
      )}
    </HStack>
  )
}

/**
 * The counters and actions of a post, reply or comment: ♡ likes (❤️ once liked, by the scan or a like still on its
 * way), 💬 answers (in a thread: answer it), 🪙 Tip and the iDNA tipped. A click on the likes or the tips opens who
 * liked and tipped; one's own post has no Tip, only its tipped total. Each action shows its fee before anything is
 * sent. `onAnswers` opens the thread.
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
  const isOwn = postAuthor === me
  const openWho = () => setIsWhoOpen(true)
  return (
    <HStack spacing={2} align="center">
      <SplitPill
        label={liked ? t('Liked') : t('Like')}
        countLabel={t('Who liked and tipped')}
        isDisabled={!canAct || liked}
        onAction={() => sending.prepareLike(target, node.id)}
        count={{action: liked ? LIKE : '♡', text: String(likes)}}
        onCount={likes > 0 ? openWho : null}
      />
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
      {isOwn ? (
        tips > 0 && (
          <Pill label={t('Who liked and tipped')} onClick={openWho}>
            🪙 {tipText(tips)}
          </Pill>
        )
      ) : (
        <SplitPill
          label={t('Tip')}
          countLabel={t('Who liked and tipped')}
          isDisabled={!canAct}
          onAction={() => setIsTipOpen(true)}
          count={{
            action: `🪙 ${t('Tip')}`,
            text: tips > 0 ? tipText(tips) : null,
          }}
          onCount={tips > 0 ? openWho : null}
        />
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

/** Who liked and who tipped, newest first: a click on a post's likes or tips opens it. */
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
                total: tipText(total),
                count: tips.length,
              })}
            </Text>
          )}
          {tips.map((tip) => (
            <WhoLine
              key={tip.hash}
              address={tip.from}
              extra={`${tipText(validTipAmount(tip))} iDNA`}
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
