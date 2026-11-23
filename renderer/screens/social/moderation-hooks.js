import React from 'react'
import {MODERATION_FIRST_BLOCK, emptyModeration, replay} from './moderation'
import {emptyModerationCache, syncModeration} from './moderation-sync'
import {socialRpc} from './node'
import {loadModerationCache, saveModerationCache} from './storage'
import {moderatedProfile} from './moderation-feed'

/** How often the app reads the contract's new calls while Community moderation is on. */
export const MODERATION_POLL_MS = 60 * 1000

const NOTHING = emptyModeration()
const NO_EVENTS = []

/**
 * The moderation state and the epoch, for the hooks outside the Social provider's own (profile-hooks.js): given by
 * the provider, nothing moderated without it.
 */
export const ModerationContext = React.createContext({
  state: NOTHING,
  epoch: null,
  me: null,
})

/** A profile read for `address` as Community moderation shows it (moderatedProfile). */
export function useModeratedProfile(profile, address) {
  const {state, epoch, me} = React.useContext(ModerationContext)
  return React.useMemo(
    () =>
      address ? moderatedProfile(profile, address, state, epoch, me) : profile,
    [address, epoch, me, profile, state]
  )
}

/**
 * Community moderation (moderation.js) while `enabled`: the cache kept on this computer, read on from the node every
 * MODERATION_POLL_MS while it is `ready`, and the state its events leave. Off, nothing is loaded or read and nothing is
 * moderated. `loading` holds until the saved cache is read and the first sync of this run has ended (well or not),
 * so that the feed does not show, and fetch, what is about to be hidden. `error` is the last sync's.
 */
export function useModeration({enabled, ready, call = socialRpc}) {
  const [cache, setCache] = React.useState()
  const [synced, setSynced] = React.useState(false)
  const [error, setError] = React.useState(null)
  // Raised to read the contract at once (an action of the account in a block): the sync starts again.
  const [nudge, setNudge] = React.useState(0)
  const cacheRef = React.useRef()

  React.useEffect(() => {
    if (!enabled) {
      cacheRef.current = undefined
      setCache(undefined)
      setSynced(false)
      setError(null)
      return undefined
    }
    let alive = true
    loadModerationCache()
      .catch(() => emptyModerationCache())
      .then((saved) => {
        if (!alive) return
        cacheRef.current = saved
        setCache(saved)
      })
    return () => {
      alive = false
    }
  }, [enabled])

  const loaded = cache !== undefined
  React.useEffect(() => {
    if (!enabled || !ready || !loaded) return undefined
    // One sync at a time in this effect; a sync of an effect cleaned up stops (its `alive`) and never holds the next.
    let alive = true
    let running = false
    const sync = async () => {
      if (running) return
      running = true
      try {
        const next = await syncModeration(
          cacheRef.current,
          call,
          (range) => {
            if (!alive) return
            cacheRef.current = range
            setCache(range)
            saveModerationCache(range).catch((saveError) =>
              global.logger?.error(
                'Cannot save the moderation cache',
                saveError?.message
              )
            )
          },
          () => !alive
        )
        if (alive) {
          cacheRef.current = next
          setError(null)
        }
      } catch (syncError) {
        if (alive) setError(syncError)
      } finally {
        running = false
        if (alive) setSynced(true)
      }
    }
    sync()
    const timer = setInterval(sync, MODERATION_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [call, enabled, loaded, nudge, ready])

  const state = React.useMemo(
    () => (enabled && cache ? replay(cache.events) : NOTHING),
    [cache, enabled]
  )
  // The feed waits only for a first read (no decisions saved yet), as the website's at most a few seconds: with a
  // saved read, its decisions apply at once and the sync brings the new ones.
  const firstRead = !loaded || cache.high < MODERATION_FIRST_BLOCK
  const loading = enabled && (!loaded || (ready && !synced && firstRead))
  const high = cache?.high ?? null
  const refresh = React.useCallback(() => setNudge((n) => n + 1), [])
  // Every event read, in chain order: the moderators' log.
  const events = enabled && cache ? cache.events : NO_EVENTS
  return React.useMemo(
    () => ({state, events, loading, error, high, refresh}),
    [error, events, high, loading, refresh, state]
  )
}
