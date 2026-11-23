import {requestDb, subDb} from '../../shared/utils/db'
import {readCache} from './scan'
import {cleanTopics} from './topics'
import {firstChatStore, readChatStore} from './messages'
import {cleanHiddenPosts, cleanHiddenWords} from './lists'
import {picturesMode} from './hiding'
import {readModerationCache} from './moderation-sync'

function socialDb() {
  return subDb(requestDb(), 'social', {valueEncoding: 'json'})
}

/** The scan saved on this computer, or null (none yet, another contract or an older version). */
export async function loadSocialCache(db = socialDb()) {
  try {
    return readCache(await db.get('cache'))
  } catch (error) {
    if (error.notFound) return null
    throw error
  }
}

export function saveSocialCache(cache, db = socialDb()) {
  return db.put('cache', cache)
}

async function getOr(db, key, fallback) {
  try {
    return await db.get(key)
  } catch (error) {
    if (error.notFound) return fallback
    throw error
  }
}

/**
 * The Social settings kept on this computer: the contacts (the phone's people.json format, blocks included), the
 * topics followed and blocked (names), the hidden words, the posts hidden (transaction hashes), the block through
 * which the notifications were seen, the kinds switched off, whether the scan is off, "Pictures in posts", and
 * whether Community moderation is on (off unless turned on).
 */
export async function loadSocialSettings(db = socialDb()) {
  const [
    people,
    topics,
    seenThrough,
    notifyOff,
    scanOff,
    hiddenWords,
    hiddenPosts,
    blockedTopics,
    picturesInPosts,
    communityModeration,
  ] = await Promise.all([
    getOr(db, 'people', null),
    getOr(db, 'topics', []),
    getOr(db, 'seenThrough', null),
    getOr(db, 'notifyOff', []),
    getOr(db, 'scanOff', false),
    getOr(db, 'hiddenWords', []),
    getOr(db, 'hiddenPosts', []),
    getOr(db, 'blockedTopics', []),
    getOr(db, 'picturesInPosts', null),
    getOr(db, 'communityModeration', false),
  ])
  return {
    people,
    topics: cleanTopics(topics),
    seenThrough: Number.isFinite(seenThrough) ? seenThrough : null,
    notifyOff: Array.isArray(notifyOff) ? notifyOff : [],
    scanOff: scanOff === true,
    hiddenWords: cleanHiddenWords(hiddenWords),
    hiddenPosts: cleanHiddenPosts(hiddenPosts),
    blockedTopics: cleanTopics(blockedTopics),
    picturesInPosts: picturesMode(picturesInPosts),
    communityModeration: communityModeration === true,
  }
}

/** What the app has read of the moderation contract (moderation-sync.js); a new cache when there is none. */
export async function loadModerationCache(db = socialDb()) {
  return readModerationCache(await getOr(db, 'moderation', null))
}

export function saveModerationCache(cache, db = socialDb()) {
  return db.put('moderation', cache)
}

export function saveSocialSetting(key, value, db = socialDb()) {
  return db.put(key, value)
}

/** The private messages of `address` (lowercase) kept on this computer: those of another account are not shown. */
/**
 * `address`'s messages kept on this computer. An account with none yet (imported here, or new) starts with
 * `firstChatStore` at `now` (seconds), saved at once.
 */
export async function loadChatStore(
  address,
  db = socialDb(),
  now = Date.now() / 1000
) {
  const saved = await getOr(db, `messages-${address}`, null)
  if (saved !== null) return readChatStore(saved)
  const first = firstChatStore(Math.floor(now))
  await db.put(`messages-${address}`, first)
  return first
}

export function saveChatStore(address, store, db = socialDb()) {
  return db.put(`messages-${address}`, store)
}
