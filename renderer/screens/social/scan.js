import {SOCIAL_CONTRACT} from './contract'
import {socialFeed, withPrefix} from './feed'
import {GROUPS_FROM} from './groups'
import {
  CURRENT_VERSION,
  HISTORY_START,
  SOCIAL_VERSIONS,
  versionAt,
} from './versions'

/**
 * 1: the first desktop scan (from bcn_contractCalls); 2: the older contracts too (`olderAuthors`); 3: the private
 * messages (still encrypted) and the callers' public keys. The one-part calls (groups' messages, groups.js) came
 * later without a new version, so that a build before them still reads the scan (an unknown version would make it
 * scan the whole history again): a build that keeps them marks what it read (`onePartLow`, `onePartTo` and
 * `onePartMessagesLow`: its low, high and messagesLow), and the blocks outside, read by a build that dropped them, are
 * read again (scanOlderGroups).
 */
export const CACHE_VERSION = 3

export {GROUPS_FROM}

/**
 * What the app has scanned, kept so that no block is scanned twice: the blocks low..high (none while high < low),
 * the posts and tips found there (those of an older contract version carry its name), the current contract's post
 * authors as of block authorsHeight, and each older version's authors (they no longer change), by version name;
 * the private messages (sendMessage calls, still encrypted) of the blocks messagesLow..high, and the public keys of
 * the callers seen (lowercase address -> hex key), to encrypt a message for them.
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
  messages: [],
  messagesLow: head + 1,
  keys: {},
  onePartLow: head + 1,
  onePartTo: head,
  onePartMessagesLow: head + 1,
})

/**
 * Whether the scan still has blocks to read again for the groups' messages (scanOlderGroups, withOnePartGaps): those
 * of groupsFloor..groupsLow - 1 that it scanned.
 */
export const groupsPending = ({groupsLow, groupsFloor, low}) =>
  Number.isFinite(groupsLow) && groupsLow > Math.max(low, groupsFloor)

/**
 * `cache` (version 3) with the blocks a build that dropped the one-part calls read to read again for them
 * (groupsPending): from GROUPS_FROM up, and above the message pass's low (below it, that pass reads them, one-part
 * calls included). Those are all of them for a scan without the marks, else those an older build added: above
 * onePartTo, below onePartLow, and between messagesLow and onePartMessagesLow (its message pass); merged with a range
 * still to read. The marks become the scan's own.
 */
export function withOnePartGaps(cache) {
  const {low, high, messagesLow} = cache
  const floor = Math.max(GROUPS_FROM, messagesLow)
  const gaps = []
  const marks = [cache.onePartLow, cache.onePartTo, cache.onePartMessagesLow]
  if (!marks.every(Number.isFinite)) gaps.push([floor, high])
  else {
    gaps.push([Math.max(floor, cache.onePartTo + 1), high])
    gaps.push([Math.max(floor, low), Math.min(cache.onePartLow - 1, high)])
    gaps.push([floor, Math.min(cache.onePartMessagesLow - 1, high)])
  }
  if (groupsPending(cache))
    gaps.push([Math.max(low, cache.groupsFloor), cache.groupsLow - 1])
  const real = gaps.filter(([from, to]) => from <= to)
  const marked = {
    ...cache,
    onePartLow: low,
    onePartTo: high,
    onePartMessagesLow: messagesLow,
  }
  if (real.length === 0) return marked
  return {
    ...marked,
    groupsFloor: Math.min(...real.map(([from]) => from)),
    groupsLow: Math.max(...real.map(([, to]) => to)) + 1,
  }
}

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
  if (saved.version === CACHE_VERSION) return withOnePartGaps(saved)
  if (saved.version !== 1 && saved.version !== 2) return null
  // An older scan read no messages: those of its blocks are read again once (scanOlderMessages), one-part calls too.
  return {
    ...saved,
    version: CACHE_VERSION,
    olderAuthors: saved.version === 1 ? {} : saved.olderAuthors,
    messages: [],
    messagesLow: saved.high + 1,
    keys: {},
    onePartLow: saved.low,
    onePartTo: saved.high,
    onePartMessagesLow: saved.high + 1,
  }
}

/**
 * Whether the current contract has blocks scanned before the app read messages, still to read for them
 * (scanOlderMessages).
 */
export const messagesPending = ({messagesLow, low}) =>
  messagesLow > Math.max(low, CURRENT_VERSION.from)

/** The messages with `more` added, each once (a backfill may read blocks again), in chain order. */
export function withMessages(messages, more = []) {
  if (more.length === 0) return messages
  const known = new Set(messages.map(({hash}) => hash))
  return messages
    .concat(more.filter(({hash}) => !known.has(hash)))
    .sort((a, b) => a.height - b.height || a.index - b.index)
}

/** The blocks where `address` (lowercase) called the contract, the newest first: their calls hold its key. */
export function callHeightsOf({posts, tips, messages}, address) {
  const heights = new Set([
    ...posts.filter(({author}) => author === address).map(({height}) => height),
    ...tips.filter(({from}) => from === address).map(({height}) => height),
    ...messages.filter(({from}) => from === address).map(({height}) => height),
  ])
  return [...heights].sort((a, b) => b - a)
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
        messages: withMessages(next.messages, found.messages),
        keys: {...next.keys, ...found.keys},
        onePartTo: to,
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
    messages: withMessages(cache.messages, older.messages),
    // The messages of these blocks are read, unless older blocks wait for them.
    messagesLow: messagesPending(cache) ? cache.messagesLow : from,
    onePartMessagesLow: messagesPending(cache) ? cache.messagesLow : from,
    keys: {...older.keys, ...cache.keys},
    onePartLow: from,
  }
  await save(next)
  return next
}

/**
 * For a scan made before the app read messages (messagesPending): one batch of the current contract's blocks it
 * read, below messagesLow, read again for their messages and keys, from the newest down.
 */
export async function scanOlderMessages(cache, source, {save = () => {}} = {}) {
  if (!messagesPending(cache)) return cache
  const bottom = Math.max(cache.low, CURRENT_VERSION.from)
  const from = Math.max(cache.messagesLow - source.batchSize(), bottom)
  const read = await source.calls(from, cache.messagesLow - 1)
  const next = {
    ...cache,
    messages: withMessages(cache.messages, read.messages),
    messagesLow: from,
    onePartMessagesLow: from,
    keys: {...read.keys, ...cache.keys},
  }
  await save(next)
  return next
}

/**
 * For a scan read in part by a build that dropped the one-part calls (groupsPending): one batch of those blocks,
 * below groupsLow, read again for them (the other calls come again too: each is kept once), from the newest down.
 */
export async function scanOlderGroups(cache, source, {save = () => {}} = {}) {
  if (!groupsPending(cache)) return cache
  const bottom = Math.max(cache.low, cache.groupsFloor)
  const from = Math.max(cache.groupsLow - source.batchSize(), bottom)
  const read = await source.calls(from, cache.groupsLow - 1)
  const next = {
    ...cache,
    messages: withMessages(cache.messages, read.messages),
    groupsLow: from,
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
