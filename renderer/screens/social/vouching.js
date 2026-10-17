/* global BigInt */
import {fromWei} from './posting'
import {isValidated, isVouchable, iterateEntries, readEntries} from './profiles'

// Vouched members and name challenges in the profiles contract (idena-profile, rulings Q-46 and Q-47): a validated
// identity vouches for accounts without an identity, which may then hold a name, write a profile and give Trust; a
// name whose holder lost its good standing is freed by a challenger calling challengeName in 3 epochs in a row.

/** The epochs after the first call of a challenge: its third call, in a row, frees the name. */
export const GRACE_EPOCHS = 2

/** The members an identity vouches for at once, and as many new vouches per epoch. */
const VOUCH_CAPS = {Human: 5, Verified: 3, Newbie: 1}
export const vouchCap = (state) => VOUCH_CAPS[state] || 0

export {isVouchable}

/** Whether a profile (readProfiles) acts as a vouched member: no identity, a validated voucher. */
export const isActingMember = (profile) =>
  Boolean(profile?.voucher) &&
  isVouchable(profile.state) &&
  isValidated(profile.voucherState)

/**
 * Whether a profile (readProfiles) is shown as vouched for: only while it has no identity of its own. The contract
 * keeps a member who validated listed with its voucher until a call of its own or the end of the vouch.
 */
export const showsVoucher = (profile) =>
  Boolean(profile?.voucher) && isVouchable(profile.state)

/** The gas a vouched member's call adds, burned by the contract (VOUCHED_EXTRA_GAS). */
const VOUCHED_EXTRA_GAS = BigInt(25000)

/**
 * What a vouched member sends with a call, in iDNA (6 places, rounded up): VOUCHED_EXTRA_GAS at the network's fee
 * per gas (`feePerGas`, 10^-18 iDNA, bcn_feePerGas), plus a tenth; the contract asks for it at the minimum fee.
 */
export const vouchedExtra = (feePerGas) =>
  fromWei(
    (BigInt(feePerGas) * VOUCHED_EXTRA_GAS * BigInt(11)) / BigInt(10),
    6,
    true
  ).replace(/\.?0+$/, '')

/** The identity states (idena-go core/state codes, as the contract keeps them) of the accounts without an identity. */
const VOUCHABLE_CODES = new Set(['0', '1', '2', '5'])

/**
 * Whether the profiles contract reads the extra amount from a call of an account with a voucher there (its
 * payIfVouched): unless it read in `epoch` that the account has an identity (`kept`, its "i:" entry
 * "<epoch>:<state>").
 */
const readsExtra = (kept, epoch) => {
  if (!kept) return true
  const [readIn, state] = String(kept).split(':')
  return Number(readIn) !== epoch || VOUCHABLE_CODES.has(state)
}

/**
 * The extra amount a call to the profiles contract sends for the caller's `profile` (readProfiles): {amount (iDNA),
 * lapsed}, or null. The contract reads it from any account with a voucher there, not only from an acting member: a
 * member who validated keeps its voucher until a call of its own, which pays it too, and a call without the amount
 * fails in the VM. `lapsed`: the account does not act as a member (it has an identity now, or its voucher is not
 * validated).
 */
export async function memberExtraFor(call, settled, profile) {
  if (!profile?.voucher) return null
  const [[kept], {epoch}] = await Promise.all([
    readEntries(settled, [['i:', profile.address.toLowerCase()]]),
    call('dna_epoch'),
  ])
  if (!readsExtra(kept, epoch)) return null
  return {
    amount: vouchedExtra(await call('bcn_feePerGas')),
    lapsed: !isActingMember(profile),
  }
}

/** The vouches offered to `member`, not accepted yet: [{voucher, epoch}]. */
export async function readOffersTo(call, member) {
  const entries = await iterateEntries(call, `o:${member.toLowerCase()}:`)
  return entries.map(({key, value}) => ({
    voucher: key.toLowerCase(),
    epoch: Number(value),
  }))
}

/** The members `voucher` vouches for: [{member, epoch accepted}]. */
export async function readMembers(call, voucher) {
  const entries = await iterateEntries(call, `m:${voucher.toLowerCase()}:`)
  return entries.map(({key, value}) => ({
    member: key.toLowerCase(),
    epoch: Number(value),
  }))
}

/** The epoch `voucher` offered to vouch for `member`, or null without such an offer. */
export async function readOffer(settled, member, voucher) {
  const [value] = await readEntries(settled, [
    ['o:', `${member.toLowerCase()}:${voucher.toLowerCase()}`],
  ])
  return value === null ? null : Number(value)
}

/** A saved challenge, "<since>:<last>:<holder>", as {since, last, holder}; null for none. */
export function parseChallenge(value) {
  if (!value) return null
  const [since, last, holder] = String(value).split(':')
  return {
    since: Number(since),
    last: Number(last),
    holder: holder.toLowerCase(),
  }
}

/** The challenge of `challenger` on `name` (parseChallenge). */
export async function readChallenge(settled, name, challenger) {
  const [value] = await readEntries(settled, [
    ['c:', `${name}:${challenger.toLowerCase()}`],
  ])
  return parseChallenge(value)
}

/**
 * Where a challenge on `holder`'s name stands at `epoch`: which call of the three the next one is (`step`, 1 to 3),
 * whether it can be made now (one call an epoch), and whether it frees the name. A challenge of another holder,
 * or one whose challenger skipped an epoch, starts again.
 */
export function challengeStep(challenge, epoch, holder) {
  const goesOn =
    challenge !== null &&
    challenge.holder === String(holder).toLowerCase() &&
    challenge.last + 1 >= epoch
  if (!goesOn) return {step: 1, canCall: true, frees: false, since: epoch}
  if (challenge.last >= epoch)
    return {
      step: Math.min(epoch - challenge.since + 2, GRACE_EPOCHS + 1),
      canCall: false,
      frees: false,
      since: challenge.since,
    }
  const step = Math.min(epoch - challenge.since + 1, GRACE_EPOCHS + 1)
  return {
    step,
    canCall: true,
    frees: epoch >= challenge.since + GRACE_EPOCHS,
    since: challenge.since,
  }
}
