import {AdBurnKey} from '../../shared/models/adBurnKey'
import {areCompetingAds} from './utils'

/**
 * The burns that compete with the ad `cid` shown to `target` (an AdTarget): those of the other ads whose audience
 * meets this one, the ads with exactly the same audience included (the closest competitors). `decodeTarget` reads a
 * burn key's target.
 */
export function competingBurns(burns, cid, target, decodeTarget) {
  return burns?.filter((burn) => {
    const key = AdBurnKey.fromHex(burn.key)
    return cid !== key.cid && areCompetingAds(decodeTarget(key.target), target)
  })
}
