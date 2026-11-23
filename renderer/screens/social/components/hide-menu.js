/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  IconButton,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Stack,
  Text,
} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
} from '../../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {displayName, person} from '../people'
import {topicChannel, topicOf} from '../topics'
import {useTrust} from '../profile-hooks'
import {ProfileCall, profilesEnabled} from '../profiles'
import {activeBan} from '../moderation'
import {ReportDialog} from './moderation-dialogs'
import {ModeratorDialog, useModerator} from './moderator-actions'

// Muting and blocking an account (⋯ on its profile or on its posts), hiding a post and blocking a topic (⋯, or the
// topic's page), as the phone app's SocialBlocking.kt and SocialMuting.kt. What they hide: hiding.js; the lists to undo them: Social settings.

const stop = (e) => e.stopPropagation()

/** ⋯, dark and big enough to see and hit (user 2026-10-17: it was too small and grey). */
function MoreButton({label}) {
  return (
    <MenuButton
      as={IconButton}
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      icon={
        <Text fontSize="lg" fontWeight={700} color="gray.700" lineHeight={1}>
          ⋯
        </Text>
      }
    />
  )
}

/**
 * Asks before blocking `address`. When the account gives it Trust, it asks whether to take the Trust back too: a
 * transaction, its fee shown next (never silently).
 */
export function BlockDialog({address, onClose}) {
  const {t} = useTranslation()
  const {me, names, people, setPerson, sending} = useSocial()
  const {data: trust} = useTrust(address)
  const isGiver = Boolean(trust?.givers.some((g) => g.address === me))
  const name = displayName(address, names)
  const block = () => {
    setPerson({...(people[address] || person(address)), blocked: true})
    onClose()
  }
  return (
    <Dialog
      title={t('Block {{name}}?', {name})}
      isOpen
      onClose={onClose}
      size="md"
    >
      <DialogBody>
        <Stack spacing={3}>
          <Text>
            {t(
              'Their posts, replies, comments, likes, tips and messages are hidden on this computer. The posts stay public on the chain: they can still see and answer yours. Unblock in Social settings, or on their profile.',
              {nsSeparator: '|'}
            )}
          </Text>
          {isGiver && (
            <Text>
              {t(
                'You give {{name}} your Trust. Remove it too? It is a transaction: its fee shows before it is sent.',
                {name, nsSeparator: '|'}
              )}
            </Text>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        {isGiver ? (
          <>
            <SecondaryButton onClick={block}>{t('Block only')}</SecondaryButton>
            <PrimaryButton
              isDisabled={
                !sending.canAct ||
                sending.isInFlight(ProfileCall.untrust(address))
              }
              onClick={() => {
                block()
                sending.prepareProfile('untrust', () =>
                  ProfileCall.untrust(address)
                )
              }}
            >
              {t('Block and remove my Trust')}
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton onClick={block}>
            {t('Block', {context: 'person'})}
          </PrimaryButton>
        )}
      </DialogFooter>
    </Dialog>
  )
}

/**
 * What Community moderation adds to a ⋯ menu for `address` (and a post's `hash`), while the setting is on and the
 * account not banned itself: for a moderator, Hide this post… and Ban (or Unban) {name}… (moderator-actions.js); for
 * everyone, Report post… and Report {name}… while the author is not banned already (moderation-dialogs.js);
 * [items, dialog].
 */
function useModerationItems(address, hash = null) {
  const {t} = useTranslation()
  const {me, names, communityModeration, moderation, epoch} = useSocial()
  const {role} = useModerator()
  const [reporting, setReporting] = React.useState(null)
  const [acting, setActing] = React.useState(null)
  if (!communityModeration || !me) return [null, null]
  const epochNumber = epoch?.epoch ?? null
  if (activeBan(moderation.state, me, epochNumber)) return [null, null]
  const name = displayName(address, names)
  const authorBanned = Boolean(
    activeBan(moderation.state, address, epochNumber)
  )
  const items = (
    <>
      {role && <MenuDivider />}
      {role && hash && (
        <MenuItem onClick={() => setActing({action: 'hidePost', hash})}>
          {t('Hide this post…')}
        </MenuItem>
      )}
      {role && (
        <MenuItem
          onClick={() =>
            setActing({action: authorBanned ? 'unban' : 'ban', address})
          }
        >
          {authorBanned
            ? t('Unban {{name}}…', {name})
            : t('Ban {{name}}…', {name})}
        </MenuItem>
      )}
      {role && !authorBanned && <MenuDivider />}
      {hash && !authorBanned && (
        <MenuItem onClick={() => setReporting({hash, author: address})}>
          {t('Report post…')}
        </MenuItem>
      )}
      {!authorBanned && (
        <MenuItem onClick={() => setReporting({address})}>
          {t('Report {{name}}…', {name})}
        </MenuItem>
      )}
    </>
  )
  const dialog = (
    <>
      {reporting && (
        <ReportDialog {...reporting} onClose={() => setReporting(null)} />
      )}
      {acting && (
        <ModeratorDialog {...acting} onClose={() => setActing(null)} />
      )}
    </>
  )
  return [items, dialog]
}

/** Mutes `address` (its posts leave the feeds: hiding.js, leavesFeeds), or unmutes it: [isMuted, toggle]. */
function useMute(address) {
  const {people, setPerson} = useSocial()
  const one = people[address] || person(address)
  return [one.muted, () => setPerson({...one, muted: !one.muted})]
}

/**
 * ⋯ on another's profile: Name on this computer (`onRename`), Mute (or Unmute) and Block (asked first); with
 * Community moderation on, Report.
 */
export function ProfileMenu({address, onRename}) {
  const {t} = useTranslation()
  const [isBlocking, setIsBlocking] = React.useState(false)
  const [isMuted, toggleMute] = useMute(address)
  const [reportItems, reportDialog] = useModerationItems(address)
  return (
    <Box onClick={stop}>
      <Menu autoSelect={false} placement="bottom-end">
        <MoreButton label={t('More')} />
        <MenuList zIndex="popover">
          <MenuItem onClick={() => onRename(address)}>
            {t('Name on this computer')}
          </MenuItem>
          <MenuItem onClick={toggleMute}>
            {isMuted ? t('Unmute') : t('Mute')}
          </MenuItem>
          <MenuItem onClick={() => setIsBlocking(true)}>
            {t('Block', {context: 'person'})}
          </MenuItem>
          {reportItems}
        </MenuList>
      </Menu>
      {isBlocking && (
        <BlockDialog address={address} onClose={() => setIsBlocking(false)} />
      )}
      {reportDialog}
    </Box>
  )
}

/**
 * ⚙ on one's own profile: Edit your public profile (`onEdit`) and Social settings (`openSettings`), as the phone app's
 * (B-79); no private name for one's own address (B-72: its claimed name shows).
 */
export function OwnProfileMenu({onEdit, openSettings}) {
  const {t} = useTranslation()
  return (
    <Box onClick={stop}>
      <Menu autoSelect={false} placement="bottom-end">
        <MenuButton
          as={IconButton}
          variant="ghost"
          size="md"
          aria-label={t('Profile and settings')}
          title={t('Profile and settings')}
          icon={
            <Text fontSize="lg" color="gray.700" lineHeight={1}>
              ⚙
            </Text>
          }
        />
        <MenuList zIndex="popover">
          {profilesEnabled && (
            <MenuItem onClick={onEdit}>
              {t('Edit your public profile')}
            </MenuItem>
          )}
          {openSettings && (
            <MenuItem onClick={openSettings}>{t('Social settings')}</MenuItem>
          )}
        </MenuList>
      </Menu>
    </Box>
  )
}

/**
 * ⋯ at the top right of a post, reply or comment of another (none on one's own): Hide (or Show again), Mute (or
 * Unmute) its author, Block its author (asked first), Block its topic; with Community moderation on, Report.
 */
export function PostMenu({call}) {
  const {t} = useTranslation()
  const {me, names, hidden, setPostHidden, setTopicBlocked} = useSocial()
  const [isBlocking, setIsBlocking] = React.useState(false)
  const [isMuted, toggleMute] = useMute(call.author)
  const [reportItems, reportDialog] = useModerationItems(call.author, call.hash)
  if (call.author === me) return null
  const name = displayName(call.author, names)
  const isHidden = hidden.posts.has(String(call.hash).toLowerCase())
  const topic = call.replyTo === '' ? topicOf(call.channel) : null
  return (
    <Box onClick={stop} flexShrink={0}>
      <Menu autoSelect={false} placement="bottom-end" isLazy>
        <MoreButton label={t('More')} />
        <MenuList zIndex="popover">
          <MenuItem onClick={() => setPostHidden(call.hash, !isHidden)}>
            {isHidden ? t('Show again') : t('Hide')}
          </MenuItem>
          <MenuItem onClick={toggleMute}>
            {isMuted
              ? t('Unmute {{name}}', {name})
              : t('Mute {{name}}', {name})}
          </MenuItem>
          <MenuItem onClick={() => setIsBlocking(true)}>
            {t('Block {{name}}', {name})}
          </MenuItem>
          {topic !== null && (
            <MenuItem onClick={() => setTopicBlocked(topic, true)}>
              {t('Block the topic {{topic}}', {topic: topicChannel(topic)})}
            </MenuItem>
          )}
          {reportItems}
        </MenuList>
      </Menu>
      {isBlocking && (
        <BlockDialog
          address={call.author}
          onClose={() => setIsBlocking(false)}
        />
      )}
      {reportDialog}
    </Box>
  )
}

/** The line in place of a text hidden (`byUser`: by the user, else for a hidden word); a click shows the text. */
export function HiddenLine({byUser, onShow}) {
  const {t} = useTranslation()
  return (
    <Text
      fontSize="md"
      color="muted"
      cursor="pointer"
      onClick={(e) => {
        e.stopPropagation()
        onShow()
      }}
    >
      {byUser
        ? t('Hidden by you. Click to show.')
        : t('Hidden: a word of your list. Click to show.', {
            nsSeparator: '|',
          })}
    </Text>
  )
}
