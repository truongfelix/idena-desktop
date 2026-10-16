import {AdBurnKey} from '../../shared/models/adBurnKey'
import {areSameCaseInsensitive} from '../../shared/utils/utils'

// A language or OS left empty takes any viewer; two set ones meet only when they are the same.
const meet = (a, b) => !a || !b || areSameCaseInsensitive(a, b)

/**
 * Whether one viewer can be shown both ads: their languages and OSes meet. A minimum age or stake never keeps two
 * ads apart (a viewer above both minimums meets both).
 */
export const canReachSameViewer = (targetA, targetB) =>
  meet(targetA.language, targetB.language) && meet(targetA.os, targetB.os)

/**
 * The burns that compete with the ad `cid` shown to `target` (an AdTarget): those of the other ads that one of its
 * viewers can be shown too, the ads with exactly the same audience included (the closest competitors).
 * `decodeTarget` reads a burn key's target.
 */
export function competingBurns(burns, cid, target, decodeTarget) {
  return burns?.filter((burn) => {
    const key = AdBurnKey.fromHex(burn.key)
    return (
      cid !== key.cid && canReachSameViewer(decodeTarget(key.target), target)
    )
  })
}
