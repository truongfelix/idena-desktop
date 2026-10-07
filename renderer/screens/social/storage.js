import {requestDb, subDb} from '../../shared/utils/db'
import {readCache} from './scan'

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
 * The Social settings kept on this computer: the contacts (the phone's people.json format), the block through
 * which the notifications were seen, the kinds switched off, and whether the scan is off.
 */
export async function loadSocialSettings(db = socialDb()) {
  const [people, seenThrough, notifyOff, scanOff] = await Promise.all([
    getOr(db, 'people', null),
    getOr(db, 'seenThrough', null),
    getOr(db, 'notifyOff', []),
    getOr(db, 'scanOff', false),
  ])
  return {
    people,
    seenThrough: Number.isFinite(seenThrough) ? seenThrough : null,
    notifyOff: Array.isArray(notifyOff) ? notifyOff : [],
    scanOff: scanOff === true,
  }
}

export function saveSocialSetting(key, value, db = socialDb()) {
  return db.put(key, value)
}
