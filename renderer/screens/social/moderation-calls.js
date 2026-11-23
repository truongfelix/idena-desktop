import {
  MAX_BAN_EPOCHS,
  MAX_REASON_BYTES,
  MAX_TRANSACTION_BATCH,
  MAX_VOUCHES,
  MODERATION_CONTRACT,
  activeBan,
  normalHex,
  vouchersOf,
} from './moderation'

// The calls of the moderation contract (moderation.js), each with one JSON argument, no iDNA sent (the contract
// never reads the amount), and the checks the app makes before a call is signed: a refused call is still charged, and
// one a callback refuses is even "successful" (no event). The node's dry run (estimateCall) checks the rest.

/** The most gas a callback of the contract gets (its default), and the least the app gives one. */
export const DEFAULT_CALLBACK_GAS = 4000000
export const MIN_CALLBACK_GAS = 1000000

const modCall = (method, arg) => ({
  contract: MODERATION_CONTRACT,
  method,
  argument: JSON.stringify(arg),
  amount: '0',
})

/** The calls, by action. A reason is optional but for reports. */
export const ModerationCall = {
  report: (address, reason) =>
    modCall('report', {address: normalHex(address), reason}),
  reportPost: (hash, reason) =>
    modCall('reportTransaction', {hash: normalHex(hash), reason}),
  // `epochs`: how many epochs the ban lasts, 0 for a permanent one.
  ban: (address, epochs, reason) =>
    modCall('ban', {address: normalHex(address), epochs, reason}),
  unban: (address, reason) =>
    modCall('unban', {address: normalHex(address), reason}),
  hidePost: (hash, reason) =>
    modCall('banTransaction', {hash: normalHex(hash), reason}),
  hidePosts: (hashes, reason) =>
    modCall('banTransactions', {hashes: hashes.map(normalHex), reason}),
  restorePost: (hash, reason) =>
    modCall('unbanTransaction', {hash: normalHex(hash), reason}),
  vouch: (address) => modCall('vouch', {address: normalHex(address)}),
  withdrawVouch: (address) =>
    modCall('withdrawVouch', {address: normalHex(address)}),
  revokeVouches: (address) =>
    modCall('revokeVouches', {address: normalHex(address)}),
}

/** A reason's size in UTF-8 bytes, as the contract counts it (at most MAX_REASON_BYTES). */
export const reasonBytes = (text) => new TextEncoder().encode(text).length

/**
 * The call with the callbacks' gas sized from a dry run's `receipt`: three times the most one used, between
 * MIN_CALLBACK_GAS and DEFAULT_CALLBACK_GAS (the max fee reserves it, twice for a ban); the same call when it ran no
 * callback.
 */
export function withSizedCallbacks(call, receipt) {
  const used = (receipt?.actionResult?.subActionResults || [])
    .flatMap(function all(sub) {
      return [sub, ...(sub?.subActionResults || []).flatMap(all)]
    })
    .filter(
      (sub) =>
        sub?.inputAction?.actionType === 1 &&
        String(sub.inputAction.method).startsWith('_')
    )
    .map((sub) => Number(sub.gasUsed || 0))
  if (used.length === 0) return call
  const gas = Math.min(
    DEFAULT_CALLBACK_GAS,
    Math.max(MIN_CALLBACK_GAS, 3 * Math.max(...used))
  )
  return {
    ...call,
    argument: JSON.stringify({...JSON.parse(call.argument), _gasLimit: gas}),
  }
}

/** The report `reporter` last made on `target` (an address or a post's hash), or null: once is enough. */
export function ownReport(state, reporter, target) {
  const from = normalHex(reporter)
  const key = normalHex(target)
  for (let i = state.reports.length - 1; i >= 0; i -= 1) {
    const report = state.reports[i]
    if (report.reporter === from && report.target === key) return report
  }
  return null
}

/**
 * Why `me` may not report (the reason as a key of ReportRefusal), or null: no account, banned, oneself, an account
 * already banned, no reason or a reason too long.
 */
export function reportRefusal(state, epoch, me, {address, reason}) {
  if (!me) return 'noAccount'
  if (activeBan(state, me, epoch)) return 'banned'
  if (address && normalHex(address) === normalHex(me)) return 'self'
  if (address && activeBan(state, address, epoch)) return 'alreadyBanned'
  if (!reason.trim()) return 'noReason'
  if (reasonBytes(reason) > MAX_REASON_BYTES) return 'tooLong'
  return null
}

/**
 * Why `me` may not act as a moderator on `target` (an address or null), or null. `role`: 'staker', 'vouched' or
 * null (moderatorRole). Checks of the contract made before signing: a ban needs a target that is no moderator
 * (`targetRole`), an epoch count within MAX_BAN_EPOCHS, a batch within MAX_TRANSACTION_BATCH.
 */
export function moderatorRefusal(
  state,
  epoch,
  me,
  role,
  {address = null, targetRole = null, epochs = 0, reason = '', count = 1} = {}
) {
  if (!me) return 'noAccount'
  if (!role) return 'notModerator'
  if (activeBan(state, me, epoch)) return 'banned'
  if (address && normalHex(address) === normalHex(me)) return 'self'
  if (targetRole === 'staker') return 'targetStaker'
  if (targetRole === 'vouched') return 'targetVouched'
  if (!Number.isInteger(epochs) || epochs < 0 || epochs > MAX_BAN_EPOCHS)
    return 'epochs'
  if (count < 1 || count > MAX_TRANSACTION_BATCH) return 'batch'
  if (reasonBytes(reason) > MAX_REASON_BYTES) return 'tooLong'
  return null
}

/**
 * The role of `address`: 'staker' (its stake, in iDNA, at least MODERATOR_STAKE), 'vouched' (a staker vouches for
 * it), or null; none while banned. `stake` as dna_identity gives it (a decimal text).
 */
export function moderatorRole(state, epoch, address, stake, threshold) {
  if (!address || activeBan(state, address, epoch)) return null
  if (Number(stake || 0) >= threshold) return 'staker'
  if (vouchersOf(state, address).length > 0) return 'vouched'
  return null
}

/** The addresses `voucher` vouches for, at most MAX_VOUCHES in effect. */
export function vouchesGiven(state, voucher) {
  const key = normalHex(voucher)
  return [...state.vouchers.entries()]
    .filter(([, vouchers]) => vouchers.has(key))
    .map(([address]) => address)
}

/** Whether `voucher` may vouch once more (fewer than MAX_VOUCHES in effect). */
export const canVouchMore = (state, voucher) =>
  vouchesGiven(state, voucher).length < MAX_VOUCHES
