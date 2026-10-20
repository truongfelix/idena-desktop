import React from 'react'
import {lacksMethod, nodeSocialSource, socialRpc} from './node'
import {
  checkNewBlocks,
  groupsPending,
  historyDone,
  messagesPending,
  scanOlderBlocks,
  scanOlderGroups,
  scanOlderMessages,
} from './scan'
import {saveSocialCache} from './storage'

/** A new block comes about every 20 seconds. */
const NEW_BLOCK_MS = 20 * 1000
const RETRY_MS = 15 * 1000
/** A node without the methods is asked again now and then: the user may switch nodes. */
const MISSING_RETRY_MS = 60 * 1000

/**
 * The scan's loop, until `stopped()`: see useSocialScan. `report` gets the node's head, its peers, the last error
 * (null after a good round) and whether the node lacks the methods (`missingMethod`): a node that starts refuses
 * every method for a moment, so the loop goes on after such an answer and clears it once a call succeeds.
 */
export async function runSocialScan({
  source,
  rpc = socialRpc,
  cacheRef,
  isPageOpen,
  pause,
  save,
  stopped,
  report,
}) {
  while (!stopped()) {
    const {current} = cacheRef
    const onPage = isPageOpen()
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
        rpc('net_peers').then((list) => (list || []).length),
      ])
      if (stopped()) return
      report.head(nodeHead)
      report.peers(nodePeers)
      if (
        !current ||
        current.high < nodeHead ||
        current.authorsHeight < current.high
      ) {
        // eslint-disable-next-line no-await-in-loop
        await checkNewBlocks(current, source, {
          keepGoing: () => !stopped(),
          save,
        })
      } else if (onPage && messagesPending(current)) {
        // Once, for a scan made before the app read messages: those of the blocks already read.
        // eslint-disable-next-line no-await-in-loop
        await scanOlderMessages(current, source, {save})
      } else if (onPage && groupsPending(current)) {
        // Once, for a scan of the build before groups: the one-part calls of the blocks it read.
        // eslint-disable-next-line no-await-in-loop
        await scanOlderGroups(current, source, {save})
      } else if (onPage && !historyDone(current)) {
        // eslint-disable-next-line no-await-in-loop
        await scanOlderBlocks(current, source, {save})
      } else {
        // eslint-disable-next-line no-await-in-loop
        await pause(NEW_BLOCK_MS)
      }
      if (!stopped()) {
        report.error(null)
        report.missingMethod(false)
      }
    } catch (scanError) {
      if (stopped()) return
      report.error(scanError)
      // eslint-disable-next-line no-await-in-loop
      const lacks = await lacksMethod(scanError, rpc)
      if (stopped()) return
      report.missingMethod(lacks)
      // eslint-disable-next-line no-await-in-loop
      await pause(lacks ? MISSING_RETRY_MS : RETRY_MS)
    }
  }
}

/**
 * The scan of idena.social, as the phone app's. While the Social page is open (`pageOpen`): the new blocks first
 * (which also reads the post authors), then the private messages of the blocks a scan read before the app read
 * them (once), then the history, one batch at a time, then each new block. Elsewhere, once
 * the history is read: only the new blocks, every 20 seconds, for the Inbox and its notices. Nothing is read
 * before the saved scan is `loaded`, while the node is not `ready`, or with the scan off; `readNewBlocks()` reads
 * the new blocks once even then. The scan is kept in `cacheRef` and given to `setCache` after each save.
 */
export function useSocialScan({
  ready,
  loaded,
  scanOff,
  pageOpen,
  cacheRef,
  setCache,
}) {
  const [head, setHead] = React.useState(null)
  const [peers, setPeers] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [missingMethod, setMissingMethod] = React.useState(false)
  const pageOpenRef = React.useRef(false)
  const wakeRef = React.useRef(() => {})

  React.useEffect(() => {
    pageOpenRef.current = pageOpen
    // The page wants the history now, not after the 20 s wait.
    if (pageOpen) wakeRef.current()
  }, [pageOpen])

  React.useEffect(() => {
    if (!ready || !loaded || scanOff) return undefined
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

    runSocialScan({
      source,
      cacheRef,
      isPageOpen: () => pageOpenRef.current,
      pause,
      save,
      stopped: () => run.stopped,
      report: {
        head: setHead,
        peers: setPeers,
        error: setError,
        missingMethod: setMissingMethod,
      },
    })

    return () => {
      run.stopped = true
      wakeRef.current()
    }
  }, [cacheRef, loaded, ready, scanOff, setCache])

  // Once something this app sent is in a block: the new blocks at once, even with the scan off (as the phone app).
  const [readOnce, setReadOnce] = React.useState(0)
  const readNewBlocks = React.useCallback(() => setReadOnce((n) => n + 1), [])
  React.useEffect(() => {
    if (readOnce === 0) return undefined
    if (!scanOff) {
      wakeRef.current()
      return undefined
    }
    if (!ready || !loaded || missingMethod || !cacheRef.current)
      return undefined
    const run = {stopped: false}
    checkNewBlocks(cacheRef.current, nodeSocialSource(), {
      keepGoing: () => !run.stopped,
      save: async (next) => {
        await saveSocialCache(next)
        cacheRef.current = next
        if (!run.stopped) setCache(next)
      },
    }).catch((readError) => !run.stopped && setError(readError))
    return () => {
      run.stopped = true
    }
    // Only a new request starts a read; the state it reads is current then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnce])

  return {head, peers, error, missingMethod, readNewBlocks}
}
