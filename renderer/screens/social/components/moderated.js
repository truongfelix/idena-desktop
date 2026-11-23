/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {Box, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {replyCount} from '../feed'
import {displayName} from '../people'
import {useSocial} from '../provider'
import {MUTED} from './theme'

/**
 * Where a post hidden by Community moderation stays because answers under it are shown (moderation-feed.js): one
 * line, as on the Idena Social website, with the moderators' reason; no author, text, media or actions.
 */
export function ModeratedLine({node, ...props}) {
  const {t} = useTranslation()
  const reason = node.moderated?.reason || ''
  return (
    <Text fontSize="sm" color={MUTED} fontStyle="italic" py={1} {...props}>
      {reason
        ? t('Post hidden by moderators · {{reason}}', {reason})
        : t('Post hidden by moderators')}
    </Text>
  )
}

/** The answers under such a post, in the feeds: a placeholder has no actions. */
export function ModeratedAnswers({node}) {
  const {t} = useTranslation()
  return (
    <SmallText>{t('{{count}} answers', {count: replyCount(node)})}</SmallText>
  )
}

/**
 * The banner of a banned account's profile, as the website's: until when (or permanently), why, and the moderator
 * who banned it (a click opens their profile, where Message is: messages from a banned account are delivered).
 */
export function BanBanner({ban, onProfile}) {
  const {t} = useTranslation()
  const {names} = useSocial()
  const until = ban.permanent
    ? t('Banned permanently by the community moderators')
    : t('Banned until epoch {{epoch}} by the community moderators', {
        epoch: ban.endEpoch,
      })
  return (
    <Box bg="red.010" borderRadius="md" px={3} py={2}>
      <Text fontSize="sm" fontWeight={500}>
        {ban.reason ? `${until} · ${ban.reason}` : until}
      </Text>
      <SmallText
        cursor="pointer"
        textDecoration="underline"
        onClick={() => onProfile?.(ban.moderator)}
      >
        {t('Banned by {{moderator}}: write to them to ask for a review.', {
          moderator: displayName(ban.moderator, names),
          nsSeparator: '|',
        })}
      </SmallText>
    </Box>
  )
}
