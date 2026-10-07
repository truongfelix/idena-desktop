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
import {MUTED} from './theme'
import {LIKE} from '../contract'
import {likeCount, replyCount, tipTotal} from '../feed'
import {timeAgo} from '../format'

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
