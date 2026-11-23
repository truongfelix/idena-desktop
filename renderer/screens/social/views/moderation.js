/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, Checkbox, Heading, HStack, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {timeAgo} from '../format'
import {MAX_TRANSACTION_BATCH} from '../moderation'
import {vouchesGiven} from '../moderation-calls'
import {
  bannedAccounts,
  hiddenPosts,
  moderationLog,
  postsByHash,
  postsToReview,
  reportGroups,
  reportResolution,
} from '../moderation-lists'
import {Chip} from '../components/chips'
import {PostBody} from '../components/post'
import {ModeratorDialog, useModerator} from '../components/moderator-actions'

export const ModerationTab = {
  Reports: 'reports',
  Banned: 'banned',
  Hidden: 'hidden',
  Log: 'log',
  Moderators: 'moderators',
  Vouches: 'vouches',
}

function Card({children, ...props}) {
  return (
    <Stack
      spacing={1.5}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      {...props}
    >
      {children}
    </Stack>
  )
}

/** A name that opens the profile. */
function Who({address, openProfile}) {
  const {names} = useSocial()
  return (
    <Text
      as="span"
      fontWeight={500}
      cursor="pointer"
      textDecoration="underline"
      onClick={() => openProfile(address)}
    >
      {displayName(address, names)}
    </Text>
  )
}

/**
 * A post the moderators review: its text and media only after Show (nothing is fetched before: it may be what they
 * hid), on this screen only; its author and a link to its thread.
 */
function ReviewedPost({node, openProfile, openThread}) {
  const {t} = useTranslation()
  const [shown, setShown] = React.useState(false)
  if (!node)
    return <SmallText>{t('The post is not in the blocks read yet.')}</SmallText>
  return (
    <Stack spacing={1}>
      <SmallText>
        <Who address={node.call.author} openProfile={openProfile} />
        {'  ·  '}
        <Text
          as="span"
          cursor="pointer"
          textDecoration="underline"
          onClick={() => openThread(node.id)}
        >
          {t('Open the thread')}
        </Text>
      </SmallText>
      {shown ? (
        <Box borderLeftWidth={2} borderColor="red.200" pl={2}>
          <PostBody call={node.call} lines={6} maxH="240px" />
        </Box>
      ) : (
        <Text
          fontSize="sm"
          color="muted"
          cursor="pointer"
          onClick={() => setShown(true)}
        >
          {t('Show (on this screen only)')}
        </Text>
      )}
    </Stack>
  )
}

function Reports({now, openProfile, openThread, act}) {
  const {t} = useTranslation()
  const {scannedFeed} = useSocial()
  const {state, epoch} = useModerator()
  const byHash = React.useMemo(() => postsByHash(scannedFeed), [scannedFeed])
  const groups = reportGroups(state, epoch)
  const resolutionText = {
    accountBanned: t('Account banned'),
    postHidden: t('Post hidden'),
    authorBanned: t('Author banned'),
  }
  if (groups.length === 0) return <SmallText>{t('No reports.')}</SmallText>
  return groups.map((group) => {
    const node = group.kind === 'post' ? byHash.get(group.target) : null
    const author = group.kind === 'post' ? node?.call.author : group.target
    const resolution = reportResolution(group, author, state, epoch)
    return (
      <Card key={`${group.kind}:${group.target}`}>
        <HStack justify="space-between">
          <Text fontWeight={500}>
            {group.kind === 'post'
              ? t('A post, reported by {{count}}', {
                  count: group.reports.length,
                })
              : t('An account, reported by {{count}}', {
                  count: group.reports.length,
                })}
          </Text>
          <SmallText>{timeAgo(group.newest, now)}</SmallText>
        </HStack>
        {group.kind === 'post' ? (
          <ReviewedPost
            node={node}
            openProfile={openProfile}
            openThread={openThread}
          />
        ) : (
          <SmallText>
            <Who address={group.target} openProfile={openProfile} />
          </SmallText>
        )}
        {group.reports.slice(0, 3).map((report) => (
          <SmallText key={`${report.reporter}:${report.time}`}>
            “{report.reason}
            {'” · '}
            <Who address={report.reporter} openProfile={openProfile} />
          </SmallText>
        ))}
        {resolution ? (
          <SmallText color="green.500">{resolutionText[resolution]}</SmallText>
        ) : (
          <HStack spacing={2}>
            {group.kind === 'post' && (
              <SecondaryButton
                size="sm"
                onClick={() => act({action: 'hidePost', hash: group.target})}
              >
                {t('Hide this post…')}
              </SecondaryButton>
            )}
            {author && (
              <SecondaryButton
                size="sm"
                onClick={() => act({action: 'ban', address: author})}
              >
                {t('Ban the account…')}
              </SecondaryButton>
            )}
          </HStack>
        )}
      </Card>
    )
  })
}

/** The account's posts not hidden yet, to hide up to MAX_TRANSACTION_BATCH at once with one reason. */
function ReviewPosts({address, now, openProfile, openThread, act, onBack}) {
  const {t} = useTranslation()
  const {scannedFeed} = useSocial()
  const {state} = useModerator()
  const posts = postsToReview(scannedFeed, state, address)
  const [chosen, setChosen] = React.useState(() => new Set())
  const toggle = (hash) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(hash)) next.delete(hash)
      else if (next.size < MAX_TRANSACTION_BATCH) next.add(hash)
      return next
    })
  return (
    <Stack spacing={3}>
      <HStack justify="space-between">
        <Text>
          <Who address={address} openProfile={openProfile} />
          {` · ${t('{{count}} posts not hidden yet', {count: posts.length})}`}
        </Text>
        <SecondaryButton size="sm" onClick={onBack}>
          {t('Back')}
        </SecondaryButton>
      </HStack>
      <HStack spacing={2}>
        <SecondaryButton
          size="sm"
          onClick={() =>
            setChosen(
              new Set(
                posts
                  .slice(0, MAX_TRANSACTION_BATCH)
                  .map((n) => n.call.hash.toLowerCase())
              )
            )
          }
        >
          {t('Choose the newest {{count}}', {
            count: Math.min(posts.length, MAX_TRANSACTION_BATCH),
          })}
        </SecondaryButton>
        <SecondaryButton
          size="sm"
          isDisabled={chosen.size === 0}
          onClick={() => act({action: 'hidePosts', hashes: [...chosen]})}
        >
          {t('Hide {{count}} posts…', {count: chosen.size})}
        </SecondaryButton>
      </HStack>
      {posts.map((node) => {
        const hash = node.call.hash.toLowerCase()
        return (
          <Card key={hash}>
            <Checkbox
              isChecked={chosen.has(hash)}
              onChange={() => toggle(hash)}
            >
              <SmallText>{timeAgo(node.call.time, now)}</SmallText>
            </Checkbox>
            <ReviewedPost
              node={node}
              openProfile={openProfile}
              openThread={openThread}
            />
          </Card>
        )
      })}
    </Stack>
  )
}

function Banned({now, openProfile, openThread, act}) {
  const {t} = useTranslation()
  const {state, epoch} = useModerator()
  const [reviewing, setReviewing] = React.useState(null)
  if (reviewing)
    return (
      <ReviewPosts
        address={reviewing}
        now={now}
        openProfile={openProfile}
        openThread={openThread}
        act={act}
        onBack={() => setReviewing(null)}
      />
    )
  const accounts = bannedAccounts(state, epoch)
  if (accounts.length === 0)
    return <SmallText>{t('No account is banned.')}</SmallText>
  return accounts.map(({address, ban}) => (
    <Card key={address}>
      <Text>
        <Who address={address} openProfile={openProfile} />
      </Text>
      <SmallText>
        {[
          ban.permanent
            ? t('Permanently')
            : t('Until epoch {{epoch}}', {epoch: ban.endEpoch}),
          ban.reason,
          timeAgo(ban.bannedAt, now),
        ]
          .filter(Boolean)
          .join(' · ')}
      </SmallText>
      <SmallText>
        {t('Banned by')}{' '}
        <Who address={ban.moderator} openProfile={openProfile} />
      </SmallText>
      <HStack spacing={2}>
        <SecondaryButton size="sm" onClick={() => setReviewing(address)}>
          {t('Review posts')}
        </SecondaryButton>
        <SecondaryButton
          size="sm"
          onClick={() => act({action: 'unban', address})}
        >
          {t('Unban…')}
        </SecondaryButton>
      </HStack>
    </Card>
  ))
}

function Hidden({now, openProfile, openThread, act}) {
  const {t} = useTranslation()
  const {scannedFeed} = useSocial()
  const {state} = useModerator()
  const byHash = React.useMemo(() => postsByHash(scannedFeed), [scannedFeed])
  const posts = hiddenPosts(state)
  if (posts.length === 0)
    return <SmallText>{t('No post is hidden one by one.')}</SmallText>
  return posts.map(({hash, hidden}) => (
    <Card key={hash}>
      <SmallText>
        {[hidden.reason, timeAgo(hidden.hiddenAt, now)]
          .filter(Boolean)
          .join(' · ')}
      </SmallText>
      <ReviewedPost
        node={byHash.get(hash)}
        openProfile={openProfile}
        openThread={openThread}
      />
      <HStack>
        <SecondaryButton
          size="sm"
          onClick={() => act({action: 'restorePost', hash})}
        >
          {t('Restore…')}
        </SecondaryButton>
      </HStack>
    </Card>
  ))
}

function Log({now, openProfile}) {
  const {t} = useTranslation()
  const {moderation} = useSocial()
  const log = moderationLog(moderation.events)
  const what = {
    ban: t('banned'),
    unban: t('unbanned'),
    banTransaction: t('hid a post'),
    unbanTransaction: t('restored a post'),
    vouch: t('vouched for'),
    vouchWithdrawn: t('withdrew the vouch for'),
    vouchesRevoked: t('revoked every vouch for'),
  }
  if (log.length === 0) return <SmallText>{t('Nothing yet.')}</SmallText>
  return log.map((event) => {
    const actor = event.moderator || event.voucher || event.staker
    return (
      <SmallText key={`${event.hash}:${event.eventIndex}`}>
        <Who address={actor} openProfile={openProfile} />
        {` ${what[event.name]} `}
        {event.address && (
          <Who address={event.address} openProfile={openProfile} />
        )}
        {event.reason ? ` · ${event.reason}` : ''}
        {` · ${timeAgo(event.time, now)}`}
      </SmallText>
    )
  })
}

function Moderators({openProfile}) {
  const {t} = useTranslation()
  const {state} = useModerator()
  const list = [...state.vouchers.entries()]
  return (
    <>
      <SmallText>
        {t(
          'Identities with 1,000,000 iDNA staked are moderators too: the contract checks their stake.',
          {nsSeparator: '|'}
        )}
      </SmallText>
      {list.length === 0 && (
        <SmallText>{t('No account is vouched for yet.')}</SmallText>
      )}
      {list.map(([address, vouchers]) => (
        <SmallText key={address}>
          <Who address={address} openProfile={openProfile} />
          {` · ${t('vouched for by')} `}
          {[...vouchers].map((voucher, i) => (
            <React.Fragment key={voucher}>
              {i > 0 && ', '}
              <Who address={voucher} openProfile={openProfile} />
            </React.Fragment>
          ))}
        </SmallText>
      ))}
    </>
  )
}

function MyVouches({openProfile, act}) {
  const {t} = useTranslation()
  const {state, me} = useModerator()
  const mine = me ? vouchesGiven(state, me) : []
  return (
    <>
      <SmallText>
        {t(
          'A staker vouches for up to 5 moderators. A vouch stays until withdrawn, or revoked by any staker.'
        )}
      </SmallText>
      {mine.length === 0 && <SmallText>{t('You vouch for nobody.')}</SmallText>}
      {mine.map((address) => (
        <HStack key={address} justify="space-between">
          <Who address={address} openProfile={openProfile} />
          <SecondaryButton
            size="sm"
            onClick={() => act({action: 'withdrawVouch', address})}
          >
            {t('Withdraw…')}
          </SecondaryButton>
        </HStack>
      ))}
    </>
  )
}

/**
 * The Moderation page (B-308), for the community moderators only: reports, banned accounts (with their posts to
 * review), posts hidden, the log, the moderators vouched for and one's own vouches. Hidden posts show only after Show.
 */
export function ModerationView({tab, setTab, now, openProfile, openThread}) {
  const {t} = useTranslation()
  const {role} = useModerator()
  const [acting, setActing] = React.useState(null)
  if (!role)
    return (
      <SmallText>
        {t(
          'This page is for the community moderators, with Community moderation on.'
        )}
      </SmallText>
    )
  const tabs = [
    [ModerationTab.Reports, t('Reports')],
    [ModerationTab.Banned, t('Banned')],
    [ModerationTab.Hidden, t('Hidden posts')],
    [ModerationTab.Log, t('Log')],
    [ModerationTab.Moderators, t('Moderators')],
    [ModerationTab.Vouches, t('My vouches')],
  ]
  const props = {now, openProfile, openThread, act: setActing}
  return (
    <Stack spacing={3} w="full">
      <Heading fontSize="xl" fontWeight={500}>
        {t('Community moderation')}
      </Heading>
      <SmallText>
        {role === 'staker'
          ? t('You moderate as a staker.')
          : t('You moderate as a vouched moderator.')}
      </SmallText>
      <HStack spacing={2} flexWrap="wrap" rowGap={2}>
        {tabs.map(([value, label]) => (
          <Chip
            key={value}
            isSelected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </Chip>
        ))}
      </HStack>
      {tab === ModerationTab.Reports && <Reports {...props} />}
      {tab === ModerationTab.Banned && <Banned {...props} />}
      {tab === ModerationTab.Hidden && <Hidden {...props} />}
      {tab === ModerationTab.Log && <Log {...props} />}
      {tab === ModerationTab.Moderators && <Moderators {...props} />}
      {tab === ModerationTab.Vouches && <MyVouches {...props} />}
      {acting && (
        <ModeratorDialog {...acting} onClose={() => setActing(null)} />
      )}
    </Stack>
  )
}
