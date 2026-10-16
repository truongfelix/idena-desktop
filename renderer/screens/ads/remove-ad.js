import {ChangeProfileAttachment} from '../../shared/models/changeProfileAttachment'
import {Profile} from '../../shared/models/profile'
import {TxType} from '../../shared/types'
import {
  cidBytes,
  fromWei,
  storeToIpfsPayload,
  toHex,
  toWei,
} from '../social/posting'

// A campaign in the profile: its published content, its review voting and its audience name one entry.
const isEntryOf = (ad) => (entry) =>
  entry.cid === ad.cid &&
  entry.contract === ad.contract &&
  (!ad.target || entry.target === ad.target)

/** The profile's ads without the campaign `ad`. */
export const profileWithout = (ads, ad) => ads.filter((x) => !isEntryOf(ad)(x))

const changeProfilePayload = (cid) =>
  `0x${new ChangeProfileAttachment({cid: cidBytes(cid)}).toHex()}`

/**
 * Plans taking the campaign `ad` out of the profile of `from`: the profile without it and the fees of storing it on
 * IPFS and of the change, from the node's estimates. An empty profile is no file to store (the node refuses to
 * store 0 bytes, and every IPFS node reads the empty file's cid at once): only the change, to that cid.
 * `call(method, params)` asks the node. Throws when the profile does not list the ad.
 */
export async function planAdRemoval(call, from, ad) {
  const {profileHash} = await call('dna_identity', [from])
  const ads = profileHash
    ? Profile.fromHex(await call('ipfs_get', [profileHash])).ads
    : []
  const remaining = profileWithout(ads, ad)
  if (remaining.length === ads.length) {
    throw new Error('your profile does not list this campaign')
  }
  const profileHex = `0x${new Profile({ads: remaining}).toHex()}`
  const profileCid = await call('ipfs_cid', [profileHex])
  const size = (profileHex.length - 2) / 2
  const [store, change] = await Promise.all([
    size === 0
      ? null
      : call('bcn_estimateTx', [
          {
            type: TxType.StoreToIpfsTx,
            from,
            payload: toHex(storeToIpfsPayload(profileCid, size)),
          },
        ]),
    call('bcn_estimateTx', [
      {
        type: TxType.ChangeProfileTx,
        from,
        payload: changeProfilePayload(profileCid),
      },
    ]),
  ])
  const fee = toWei(store?.txFee) + toWei(change?.txFee)
  return {from, profileHex, profileCid, fee: fromWei(fee, 6, true)}
}

/**
 * Sends a removal planned by planAdRemoval: the new profile to IPFS and its storage (unless it is empty), then the
 * profile change.
 */
export async function sendAdRemoval(call, {from, profileHex, profileCid}) {
  if (profileHex !== '0x') {
    const cid = await call('ipfs_add', [profileHex, true])
    if (cid !== profileCid) throw new Error('IPFS gave the profile another cid')
    await call('dna_storeToIpfs', [{cid}])
  }
  return call('dna_sendTransaction', [
    {
      type: TxType.ChangeProfileTx,
      from,
      payload: changeProfilePayload(profileCid),
    },
  ])
}
