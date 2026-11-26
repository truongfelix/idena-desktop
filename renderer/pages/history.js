import React from 'react'
import {useRouter} from 'next/router'
import {historyPageTarget} from '../screens/history/utils'

// The History page is gone (B-317): its ceremonies and mining are on My Idena, its transactions on Wallets. An old
// link to it lands in the new place.
export default function HistoryPage() {
  const router = useRouter()
  React.useEffect(() => {
    if (router.isReady) router.replace(historyPageTarget(router.query))
  }, [router])
  return null
}
