import React from 'react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {useClosableToast} from '../../shared/hooks/use-toast'
import {ActivityKind, newActivity, noticesTitle} from './activity'
import {displayName} from './people'

/**
 * A notice for each new thing on your posts (`activity` of the kinds `notifyKinds`), once, unless the notifications
 * are on screen (`inboxOpen`). What the scan had when the app started, and what was seen, is not announced.
 */
export function useActivityNotices({
  activity,
  cache,
  seenThrough,
  notifyKinds,
  names,
  inboxOpen,
}) {
  const {t} = useTranslation()
  const router = useRouter()
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
    } else title = noticesTitle(news, t)
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
}
