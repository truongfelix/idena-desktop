import {SOCIAL_CONTRACT} from './contract'
import {socialFeed, withPrefix} from './feed'
import {HISTORY_START, SOCIAL_VERSIONS, versionAt} from './versions'

/** 1: the first desktop scan (from bcn_contractCalls); 2: the older contracts too (`olderAuthors`). */
export const CACHE_VERSION = 2

/**
 * What the app has scanned, kept so that no block is scanned twice: the blocks low..high (none while high < low),
 * the posts and tips found there (those of an older contract version carry its name), the current contract's post
 * authors as of block authorsHeight, and each older version's authors (they no longer change), by version name.
 */
export const emptyCache = (head) => ({
  contract: SOCIAL_CONTRACT,
  version: CACHE_VERSION,
  low: head + 1,
  high: head,
  posts: [],
  tips: [],
  authors: {},
  authorsHeight: 0,
  olderAuthors: {},
})

/**
 * The cache as saved, or null when it is for another contract or an unknown version. A first version's scan holds
 * only the current contract's blocks: it goes on below them.
 */
export function readCache(saved) {
  if (
    !saved ||
    String(saved.contract).toLowerCase() !== SOCIAL_CONTRACT.toLowerCase()
  )
    return null
  if (saved.version === 1)
    return {...saved, version: CACHE_VERSION, olderAuthors: {}}
  return saved.version === CACHE_VERSION ? saved : null
}

/** Whether the scan reached the first block of idena.social's history. */
export const historyDone = (cache) => cache.low <= HISTORY_START

/** The share of the history's blocks scanned, 0 to 1. */
export function scannedShare({low, high}) {
  if (high < HISTORY_START) return 0
  return (
    Math.max(0, high - Math.max(low, HISTORY_START) + 1) /
    (high - HISTORY_START + 1)
  )
}

/**
 * The feed of the posts and tips the author maps cover: the current contract's, then each older version's once
 * the scan read all its blocks (its ids count from its first post), with the version's prefix. The versions
 * follow each other in time, so the feed stays newest first.
 */
export function cacheFeed({
  posts,
  tips,
  authors,
  authorsHeight,
  low,
  olderAuthors = {},
}) {
  const current = socialFeed(
    posts.filter(({version, height}) => !version && height <= authorsHeight),
    authors,
    tips.filter(({version, height}) => !version && height <= authorsHeight)
  )
  const older = SOCIAL_VERSIONS.slice(1).flatMap((version) =>
    olderAuthors[version.name] && low <= version.from
      ? withPrefix(
          socialFeed(
            posts.filter((post) => post.version === version.name),
            olderAuthors[version.name],
            tips.filter((tip) => tip.version === version.name),
            {fromOldest: true}
          ),
          version.prefix
        )
      : []
  )
  return current.concat(older)
}

/**
 * Scans the blocks after the cache up to the node's head, in batches (source.batchSize()) saved as they complete,
 * then reads the post authors at that head. The authors are only taken when the head did not move meanwhile, so
 * that they match the scanned blocks; otherwise it scans the new blocks again, up to 3 times. Without a cache, the
 * scan starts at the head: the older blocks are the history (scanOlderBlocks). It stops before a batch when
 * keepGoing() turns false, keeping the batches done and the previous authors. `source`: {head(), batchSize(),
 * calls(from, to), authors()}.
 */
export async function checkNewBlocks(
  cache,
  source,
  {keepGoing = () => true, save = () => {}} = {}
) {
  let current = cache
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const head = await source.head()
    let next = current || emptyCache(head)
    while (next.high < head) {
      if (!keepGoing()) return next
      const to = Math.min(next.high + source.batchSize(), head)
      // eslint-disable-next-line no-await-in-loop
      const found = await source.calls(next.high + 1, to)
      next = {
        ...next,
        high: to,
        posts: next.posts.concat(found.posts),
        tips: next.tips.concat(found.tips),
      }
      // eslint-disable-next-line no-await-in-loop
      await save(next)
    }
    // eslint-disable-next-line no-await-in-loop
    const authors = await source.authors()
    // eslint-disable-next-line no-await-in-loop
    if ((await source.head()) === head) {
      next = {...next, authors, authorsHeight: head}
      // eslint-disable-next-line no-await-in-loop
      await save(next)
      return next
    }
    current = next
  }
  return current
}

/**
 * Scans one batch of blocks before the cache, down to the first block of the history, with the contract version of
 * those blocks: a batch never spans two versions. An older version's authors are read once, with its first batch.
 */
export async function scanOlderBlocks(cache, source, {save = () => {}} = {}) {
  if (historyDone(cache)) return cache
  const version = versionAt(cache.low - 1)
  const from = Math.max(cache.low - source.batchSize(), version.from)
  const older = await source.calls(from, cache.low - 1, version)
  let {olderAuthors = {}} = cache
  if (version.prefix && !olderAuthors[version.name])
    olderAuthors = {
      ...olderAuthors,
      [version.name]: await source.authors(version),
    }
  const next = {
    ...cache,
    low: from,
    posts: older.posts.concat(cache.posts),
    tips: older.tips.concat(cache.tips),
    olderAuthors,
  }
  await save(next)
  return next
}

/** Blocks the scan may lag the node's head and still be up to date: a block comes about every 20 s. */
export const UP_TO_DATE_LAG = 3

/**
 * The scan's state from the node ({peers, syncing, validation}; null when it does not answer), its head and the
 * cache: {health: good | warn | bad | off, kind, behind?, share?}. Bad without the node or its peers; off during
 * a validation; behind while the node syncs, the posts are more than UP_TO_DATE_LAG blocks behind its head, or
 * the history is not read yet.
 */
export function scanState(node, head, cache) {
  if (!node) return {health: 'bad', kind: 'noNode'}
  if (node.peers === 0) return {health: 'bad', kind: 'noPeers'}
  if (node.validation) return {health: 'off', kind: 'validation'}
  if (node.syncing) return {health: 'warn', kind: 'syncing'}
  if (!cache) return {health: 'warn', kind: 'starting'}
  const behind = (head ?? cache.authorsHeight) - cache.authorsHeight
  if (behind > UP_TO_DATE_LAG) return {health: 'warn', kind: 'behind', behind}
  if (!historyDone(cache))
    return {health: 'warn', kind: 'history', share: scannedShare(cache)}
  return {health: 'good', kind: 'upToDate'}
}
