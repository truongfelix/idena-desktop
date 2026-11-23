import {
  MODERATION_CONTRACT,
  MODERATION_FIRST_BLOCK,
  callEvents,
} from './moderation'
import {BLOCKS_PER_CALL} from './node'

/** 1: the first (events decoded by moderation.js, in chain order). */
export const MODERATION_CACHE_VERSION = 1

/** The most blocks one bcn_blocksWithAddress call checks (the node refuses 100,000). */
export const MODERATION_RANGE = 50000

/**
 * What the app has read of the moderation contract, kept on this computer: its events in the blocks up to `high`.
 */
export const emptyModerationCache = () => ({
  contract: MODERATION_CONTRACT,
  version: MODERATION_CACHE_VERSION,
  high: MODERATION_FIRST_BLOCK - 1,
  events: [],
})

/** The cache as saved, or a new one when there is none, or it is for another contract or another version. */
export function readModerationCache(saved) {
  if (
    !saved ||
    String(saved.contract).toLowerCase() !== MODERATION_CONTRACT ||
    saved.version !== MODERATION_CACHE_VERSION ||
    !Number.isFinite(saved.high) ||
    !Array.isArray(saved.events)
  )
    return emptyModerationCache()
  return saved
}

/**
 * The cache read on through the node's last block: bcn_blocksWithAddress finds the blocks with a call of the
 * contract, bcn_contractCalls (with their events) reads them. `onRange(cache)` gets the cache after each range read,
 * to save it. An error stops at the last range read whole, never skipping a block. Once `stopped()` is true it asks
 * the node nothing more and returns the cache as it was.
 */
export async function syncModeration(
  cache,
  call,
  onRange = () => {},
  stopped = () => false
) {
  const head = (await call('bcn_lastBlock')).height
  let current = cache
  while (current.high < head) {
    if (stopped()) return cache
    const from = current.high + 1
    const to = Math.min(head, from + MODERATION_RANGE - 1)
    // eslint-disable-next-line no-await-in-loop
    const heights = await call('bcn_blocksWithAddress', [
      {address: MODERATION_CONTRACT, from, to},
    ])
    const found = []
    for (let i = 0; i < (heights || []).length; i += BLOCKS_PER_CALL) {
      if (stopped()) return cache
      // eslint-disable-next-line no-await-in-loop
      const calls = await call('bcn_contractCalls', [
        {
          contract: MODERATION_CONTRACT,
          heights: heights.slice(i, i + BLOCKS_PER_CALL),
          events: true,
        },
      ])
      found.push(...callEvents(calls || []))
    }
    current = {...current, high: to, events: [...current.events, ...found]}
    onRange(current)
  }
  return current
}
