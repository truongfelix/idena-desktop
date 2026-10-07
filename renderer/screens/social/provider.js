/* eslint-disable react/prop-types */
import React from 'react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {useChainState} from '../../shared/providers/chain-context'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useIdentityState} from '../../shared/providers/identity-context'
import {useClosableToast} from '../../shared/hooks/use-toast'
import {EpochPeriod} from '../../shared/types'
import {
  isMissingMethod,
  loadSocialCache,
  loadSocialSettings,
  nodeSocialSource,
  saveSocialCache,
  saveSocialSetting,
  socialRpc,
} from './node'
import {
  peopleFromJson,
  peopleNames,
  peopleToJson,
  displayName,
  withPerson,
} from './people'
import {
  ActivityKind,
  NotifyKind,
  cacheFeed,
  checkNewBlocks,
  countNotices,
  historyDone,
  newActivity,
  scanOlderBlocks,
  socialActivity,
} from './utils'

/** A new block comes about every 20 seconds. */
const NEW_BLOCK_MS = 20 * 1000
const RETRY_MS = 15 * 1000

const SocialContext = React.createContext(null)

export const useSocial = () => React.useContext(SocialContext)

/**
 * idena.social for the whole app, read from the node as the phone app does. While the Social page is open: the new
 * blocks first (which also reads the post authors), then the history, one batch at a time, then each new block.
 * Elsewhere, once the history is read: only the new blocks, every 20 seconds, for the Inbox and its notices.
 * Nothing is read while the node syncs, is offline, during a validation, or with the scan off. The scan, the
 * contacts and the settings are kept on this computer.
 */
export function SocialProvider({children}) {
  const {t} = useTranslation()
  const router = useRouter()
  const {syncing, offline} = useChainState()
  const epoch = useEpochState()
  const identity = useIdentityState()
  const me = identity?.address?.toLowerCase() || null
  const validation =
    Boolean(epoch?.currentPeriod) && epoch.currentPeriod !== EpochPeriod.None
  const ready = !offline && !syncing && !validation

  const [cache, setCache] = React.useState()
  const [settings, setSettings] = React.useState()
  const [head, setHead] = React.useState(null)
  const [peers, setPeers] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [missingMethod, setMissingMethod] = React.useState(false)
  const [pageOpen, setPageOpen] = React.useState(false)
  const [inboxOpen, setInboxOpen] = React.useState(false)
  const [highlightAfter, setHighlightAfter] = React.useState(null)

  const cacheRef = React.useRef()
  const pageOpenRef = React.useRef(false)
  const wakeRef = React.useRef(() => {})

  React.useEffect(() => {
    let alive = true
    Promise.all([
      loadSocialCache().catch(() => null),
      loadSocialSettings().catch(() => ({
        people: null,
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

  React.useEffect(() => {
    pageOpenRef.current = pageOpen
    // The page wants the history now, not after the 20 s wait.
    if (pageOpen) wakeRef.current()
  }, [pageOpen])

  const loaded = cache !== undefined && settings !== undefined
  const scanOff = settings?.scanOff === true

  React.useEffect(() => {
    if (!ready || !loaded || missingMethod || scanOff) return undefined
    const run = {stopped: false}
    const source = nodeSocialSource()
    const save = async (next) => {
      await saveSocialCache(next)
      cacheRef.current = next
      if (!run.stopped) setCache(next)
    }
    const pause = (ms) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        wakeRef.current = () => {
          clearTimeout(timer)
          resolve()
        }
      })

    ;(async () => {
      while (!run.stopped) {
        const {current} = cacheRef
        const onPage = pageOpenRef.current
        // Away from the page, nothing is read before the history has been read once.
        if (!onPage && !(current && historyDone(current))) {
          // eslint-disable-next-line no-await-in-loop
          await pause(NEW_BLOCK_MS)
          // eslint-disable-next-line no-continue
          continue
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const [nodeHead, nodePeers] = await Promise.all([
            source.head(),
            socialRpc('net_peers').then((list) => (list || []).length),
          ])
          if (run.stopped) return
          setHead(nodeHead)
          setPeers(nodePeers)
          if (
            !current ||
            current.high < nodeHead ||
            current.authorsHeight < current.high
          ) {
            // eslint-disable-next-line no-await-in-loop
            await checkNewBlocks(current, source, {
              keepGoing: () => !run.stopped,
              save,
            })
          } else if (onPage && !historyDone(current)) {
            // eslint-disable-next-line no-await-in-loop
            await scanOlderBlocks(current, source, {save})
          } else {
            // eslint-disable-next-line no-await-in-loop
            await pause(NEW_BLOCK_MS)
          }
          if (!run.stopped) setError(null)
        } catch (scanError) {
          if (run.stopped) return
          setError(scanError)
          if (isMissingMethod(scanError)) {
            setMissingMethod(true)
            return
          }
          // eslint-disable-next-line no-await-in-loop
          await pause(RETRY_MS)
        }
      }
    })()

    return () => {
      run.stopped = true
      wakeRef.current()
    }
  }, [loaded, missingMethod, ready, scanOff])

  const feed = React.useMemo(() => (cache ? cacheFeed(cache) : []), [cache])
  const people = React.useMemo(() => settings?.people || {}, [settings])
  const names = React.useMemo(() => peopleNames(people), [people])
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

  // A notice for each new thing, once, unless the notifications are on screen.
  const {toast} = useClosableToast()
  const announcedRef = React.useRef(null)
  React.useEffect(() => {
    if (seenThrough === null || !cache) return
    if (announcedRef.current === null) {
      announcedRef.current = Math.max(seenThrough, cache.authorsHeight)
      return
    }
    const news = newActivity(
      activity,
      Math.max(seenThrough, announcedRef.current),
      notifyKinds
    )
    announcedRef.current = Math.max(announcedRef.current, cache.authorsHeight)
    if (news.length === 0 || inboxOpen) return
    let title
    if (news.length === 1) {
      const [item] = news
      const who = displayName(item.actor, names)
      title = {
        [ActivityKind.Like]: t('{{who}} liked your post', {who}),
        [ActivityKind.Reply]: t('{{who}} replied to your post', {who}),
        [ActivityKind.Comment]: t('{{who}} commented on your post', {who}),
        [ActivityKind.Tip]: t('{{who}} tipped you {{amount}} iDNA', {
          who,
          amount: item.amount,
        }),
      }[item.kind]
    } else {
      const counts = countNotices(news)
      title = t(
        '{{count}} new on your posts ({{likes}} likes, {{comments}} answers, {{tips}} tips)',
        {count: news.length, ...counts}
      )
    }
    toast({
      title,
      actionContent: t('View'),
      onAction: () =>
        router.push({pathname: '/social', query: {view: 'inbox'}}),
    })
  }, [
    activity,
    cache,
    inboxOpen,
    names,
    notifyKinds,
    router,
    seenThrough,
    t,
    toast,
  ])

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

  const setPeople = React.useCallback(
    (list) => updateSettings('people', list, peopleToJson(list)),
    [updateSettings]
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
      setPerson,
      setPeople,
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
      setPageOpen,
      setInboxOpen,
    }),
    [
      activity,
      cache,
      epoch,
      error,
      feed,
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
      scanOff,
      setPeople,
      setPerson,
      syncing,
      unread,
      updateSettings,
      validation,
    ]
  )

  return (
    <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
  )
}
