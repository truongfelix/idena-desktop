import React from 'react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {useClosableToast} from '../../shared/hooks/use-toast'
import {ActivityKind, newActivity, noticesTitle} from './activity'
import {displayName} from './people'

/** How long a notice waits for the names of the identities in it (B-127): a profile read takes a few seconds. */
export const NAME_WAIT_MS = 10 * 1000

/**
 * Whether the notice of `news` waits for names: while the profiles are being read (`readingNames`), as long as an
 * identity in it has no name in `names` yet (a new liker's profile is read after the like).
 */
export const waitsForNames = (news, names, readingNames) =>
  readingNames && news.some(({actor}) => !names[String(actor).toLowerCase()])

/** The title of the notice of `news`: who did what for one item (its name, else its short address), else counts. */
export function noticeTitle(news, names, t) {
  if (news.length !== 1) return noticesTitle(news, t)
  const [item] = news
  const who = displayName(item.actor, names)
  return {
    [ActivityKind.Like]: t('{{who}} liked your post', {who}),
    [ActivityKind.Reply]: t('{{who}} replied to your post', {who}),
    [ActivityKind.Comment]: t('{{who}} commented on your post', {who}),
    [ActivityKind.Tip]: t('{{who}} tipped you {{amount}} iDNA', {
      who,
      amount: item.amount,
    }),
  }[item.kind]
}

/**
 * A notice for each new thing on your posts (`activity` of the kinds `notifyKinds`), once, unless the notifications
 * are on screen (`inboxOpen`). What the scan had when the app started, and what was seen, is not announced. A
 * notice waits up to NAME_WAIT_MS for the names of its identities while they are read (`readingNames`).
 */
export function useActivityNotices({
  activity,
  cache,
  seenThrough,
  notifyKinds,
  names,
  readingNames = false,
  inboxOpen,
}) {
  const {t} = useTranslation()
  const router = useRouter()
  const {toast} = useClosableToast()
  const announcedRef = React.useRef(null)
  // The news not announced yet, and since when it waits for names.
  const waitingRef = React.useRef({news: [], since: 0})
  // A turn of the effect once the wait for names is over.
  const [waitOver, setWaitOver] = React.useState(0)

  React.useEffect(() => {
    if (seenThrough === null || !cache) return undefined
    if (announcedRef.current === null) {
      announcedRef.current = Math.max(seenThrough, cache.authorsHeight)
      return undefined
    }
    const news = newActivity(
      activity,
      Math.max(seenThrough, announcedRef.current),
      notifyKinds
    )
    announcedRef.current = Math.max(announcedRef.current, cache.authorsHeight)
    const waiting = waitingRef.current
    if (inboxOpen) {
      waitingRef.current = {news: [], since: 0}
      return undefined
    }
    if (news.length > 0) {
      waitingRef.current = {
        news: waiting.news.concat(news),
        since: waiting.news.length > 0 ? waiting.since : Date.now(),
      }
    }
    const {news: all, since} = waitingRef.current
    if (all.length === 0) return undefined
    const left = since + NAME_WAIT_MS - Date.now()
    if (left > 0 && waitsForNames(all, names, readingNames)) {
      const timer = setTimeout(() => setWaitOver((n) => n + 1), left)
      return () => clearTimeout(timer)
    }
    waitingRef.current = {news: [], since: 0}
    toast({
      title: noticeTitle(all, names, t),
      actionContent: t('View'),
      onAction: () =>
        router.push({pathname: '/social', query: {view: 'notifications'}}),
    })
    return undefined
  }, [
    activity,
    cache,
    inboxOpen,
    names,
    notifyKinds,
    readingNames,
    router,
    seenThrough,
    t,
    toast,
    waitOver,
  ])
}
