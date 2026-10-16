/* eslint-disable react/prop-types */
import React from 'react'
import {useChainState} from '../../shared/providers/chain-context'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useIdentityState} from '../../shared/providers/identity-context'
import {EpochPeriod} from '../../shared/types'
import {
  peopleFromJson,
  peopleNames,
  peopleToJson,
  person,
  withPerson,
} from './people'
import {newActivity, NotifyKind, socialActivity} from './activity'
import {postTargets} from './feed'
import {cacheFeed} from './scan'
import {useActivityNotices} from './notices'
import {useSocialScan} from './scan-loop'
import {useSocialSending} from './sending'
import {useChats} from './chats'
import {nodeMessages} from './node'
import {loadSocialCache, loadSocialSettings, saveSocialSetting} from './storage'
import {feedAddresses, useProfiles, useRefreshProfiles} from './profile-hooks'
import {shownNames} from './profiles'

const SocialContext = React.createContext(null)

export const useSocial = () => React.useContext(SocialContext)

/**
 * idena.social for the whole app, read from the node as the phone app does (the scan: scan-loop.js) and written
 * with the node's key (sending.js). Nothing is read while the node syncs, is offline, during a validation, or with
 * the scan off. The scan, the contacts and the settings are kept on this computer.
 */
export function SocialProvider({children}) {
  const {syncing, offline} = useChainState()
  const epoch = useEpochState()
  const identity = useIdentityState()
  const me = identity?.address?.toLowerCase() || null
  const validation =
    Boolean(epoch?.currentPeriod) && epoch.currentPeriod !== EpochPeriod.None
  const ready = !offline && !syncing && !validation

  const [cache, setCache] = React.useState()
  const [settings, setSettings] = React.useState()
  const [pageOpen, setPageOpen] = React.useState(false)
  const [inboxOpen, setInboxOpen] = React.useState(false)
  const [highlightAfter, setHighlightAfter] = React.useState(null)

  const cacheRef = React.useRef()

  React.useEffect(() => {
    let alive = true
    Promise.all([
      loadSocialCache().catch(() => null),
      loadSocialSettings().catch(() => ({
        people: null,
        topics: [],
        seenThrough: null,
        notifyOff: [],
        scanOff: false,
      })),
    ]).then(([saved, savedSettings]) => {
      if (!alive) return
      cacheRef.current = saved
      setCache(saved)
      setSettings({
        ...savedSettings,
        people: peopleFromJson(savedSettings.people),
      })
    })
    return () => {
      alive = false
    }
  }, [])

  const loaded = cache !== undefined && settings !== undefined
  const scanOff = settings?.scanOff === true

  const {head, peers, error, missingMethod, readNewBlocks} = useSocialScan({
    ready,
    loaded,
    scanOff,
    pageOpen,
    cacheRef,
    setCache,
  })

  const feed = React.useMemo(() => (cache ? cacheFeed(cache) : []), [cache])
  const targets = React.useMemo(() => postTargets(feed), [feed])
  const refreshProfiles = useRefreshProfiles()
  const sending = useSocialSending({
    ready,
    readNewBlocks,
    scannedThrough: cache?.authorsHeight ?? 0,
    onProfileChange: refreshProfiles,
  })
  const people = React.useMemo(() => settings?.people || {}, [settings])
  const chats = useChats({me, cache, ready, people})
  // The profiles of everyone shown: their claimed names, then the private ones given here, which win.
  const shownAddresses = React.useMemo(() => {
    const addresses = feedAddresses(feed)
    Object.keys(people).forEach((a) => addresses.add(a))
    chats.conversations.forEach(({others}) =>
      others.forEach((a) => addresses.add(a))
    )
    if (me) addresses.add(me)
    return addresses
  }, [chats.conversations, feed, me, people])
  const profiles = useProfiles(shownAddresses)
  const names = React.useMemo(
    () => ({...shownNames(profiles), ...peopleNames(people)}),
    [people, profiles]
  )
  const notifyKinds = React.useMemo(
    () =>
      Object.values(NotifyKind).filter(
        (kind) => !(settings?.notifyOff || []).includes(kind)
      ),
    [settings]
  )
  const activity = React.useMemo(
    () => (me ? socialActivity(feed, me) : []),
    [feed, me]
  )
  const seenThrough = settings?.seenThrough ?? null

  const updateSettings = React.useCallback((key, next, saved = next) => {
    setSettings((current) => ({...current, [key]: next}))
    saveSocialSetting(key, saved).catch((saveError) =>
      global.logger?.error(
        'Cannot save a Social setting',
        key,
        saveError?.message
      )
    )
  }, [])

  // The first scan marks what is already there as seen.
  React.useEffect(() => {
    if (settings && seenThrough === null && cache?.authorsHeight > 0)
      updateSettings('seenThrough', cache.authorsHeight)
  }, [cache, seenThrough, settings, updateSettings])

  const unread = React.useMemo(
    () =>
      seenThrough === null
        ? []
        : newActivity(activity, seenThrough, notifyKinds),
    [activity, notifyKinds, seenThrough]
  )

  useActivityNotices({
    activity,
    cache,
    seenThrough,
    notifyKinds,
    names,
    inboxOpen,
  })

  const markSeen = React.useCallback(() => {
    if (!cache) return
    setHighlightAfter(seenThrough)
    if (cache.authorsHeight > (seenThrough ?? 0))
      updateSettings('seenThrough', cache.authorsHeight)
  }, [cache, seenThrough, updateSettings])

  const setPerson = React.useCallback(
    (next) => {
      const list = withPerson(people, next)
      updateSettings('people', list, peopleToJson(list))
    },
    [people, updateSettings]
  )

  const followedTopics = React.useMemo(() => settings?.topics || [], [settings])

  const setTopicFollowed = React.useCallback(
    (name, follow) => {
      const others = followedTopics.filter((topic) => topic !== name)
      updateSettings('topics', follow ? [...others, name].sort() : others)
    },
    [followedTopics, updateSettings]
  )

  const setPeople = React.useCallback(
    (list) => updateSettings('people', list, peopleToJson(list)),
    [updateSettings]
  )

  const {messageKeys} = chats
  // Sends `text` to `others` (lowercase) once each one's public key is known.
  const sendMessage = React.useCallback(
    (others, text) => {
      const keys = others.map((address) => messageKeys[address] || '')
      if (keys.some((key) => key === '')) return
      sending.prepareMessage(others, keys, text, nodeMessages().encrypt)
    },
    [messageKeys, sending]
  )

  // Takes a conversation out of Requests: its people are marked to message.
  const acceptChat = React.useCallback(
    (conversation) => {
      let list = people
      for (const address of conversation.others)
        list = withPerson(list, {
          ...(list[address] || person(address)),
          message: true,
        })
      updateSettings('people', list, peopleToJson(list))
    },
    [people, updateSettings]
  )

  const value = React.useMemo(
    () => ({
      cache,
      feed,
      head,
      error,
      missingMethod,
      epochStart: epoch?.startBlock ?? null,
      node: offline ? null : {peers, syncing, validation},
      me,
      people,
      names,
      profiles,
      setPerson,
      setPeople,
      followedTopics,
      setTopicFollowed,
      setFollowedTopics: (list) => updateSettings('topics', list),
      activity,
      unread,
      highlightAfter,
      markSeen,
      notifyKinds,
      setNotifyKinds: (kinds) =>
        updateSettings(
          'notifyOff',
          Object.values(NotifyKind).filter((kind) => !kinds.includes(kind))
        ),
      scanOff,
      setScanOff: (off) => updateSettings('scanOff', off),
      ready,
      targets,
      sending,
      setPageOpen,
      setInboxOpen,
      ...chats,
      sendMessage,
      acceptChat,
    }),
    [
      acceptChat,
      activity,
      cache,
      chats,
      epoch,
      error,
      feed,
      followedTopics,
      head,
      highlightAfter,
      markSeen,
      me,
      missingMethod,
      names,
      notifyKinds,
      offline,
      peers,
      people,
      profiles,
      ready,
      scanOff,
      sendMessage,
      sending,
      setPeople,
      setPerson,
      setTopicFollowed,
      syncing,
      targets,
      unread,
      updateSettings,
      validation,
    ]
  )

  return (
    <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
  )
}
