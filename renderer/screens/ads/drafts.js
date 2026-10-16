import {nanoid} from 'nanoid'
import {dexieDb} from '../../shared/utils/dexieDb'
import {AdStatus} from './types'

/**
 * A new draft from a stored ad: its texts, audience and pictures, under the id `id`; never its published content
 * (cid), voting (contract) or status, so it can be changed and sent to review on its own.
 */
export function draftFrom(ad, id, author) {
  const {title, desc, url, language, age, os, stake, thumb, media} = ad
  return {
    title,
    desc,
    url,
    language,
    age,
    os,
    stake,
    thumb,
    media,
    id,
    author,
    status: AdStatus.Draft,
  }
}

/** Stores a new draft made from the stored ad `adId` ("Edit as a new draft"); resolves to the draft's id. */
export async function copyAdAsDraft(adId, author, id = nanoid()) {
  const ad = await dexieDb.table('ads').get(adId)
  if (!ad) throw new Error(`no stored ad ${adId}`)
  await dexieDb.table('ads').add(draftFrom(ad, id, author))
  return id
}
