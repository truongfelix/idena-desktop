// Community moderation (B-308): the idena.social moderation contract (github N3CR0M4NC3R-dev/idena.social-mod, MIT)
// records banned accounts, hidden posts (transaction bans), the moderators vouched for and the reports. It hides
// nothing itself: the app reads its events and applies the idena.social website's rules (idena.social-ui
// docs/moderation.md). Off by default (the Social setting "Community moderation"): the app then reads nothing from it.

/**
 * A test network's copy of the contract, given when the app starts: IDENA_MODERATION_CONTRACT=<address>@<first
 * block>. The app reads and writes mainnet's otherwise.
 */
const testContract = /^(0x[0-9a-fA-F]{40})@([0-9]{1,12})$/.exec(
  global.env?.IDENA_MODERATION_CONTRACT || ''
)

/** Mainnet's contract, deployed 2026-11-22 (tx 0x47a94c52…) at block 11,605,462, and the block its calls start. */
export const MODERATION_CONTRACT = (
  testContract ? testContract[1] : '0x8A44bA305c09375F6a1f553920e49daE4875A5E5'
).toLowerCase()
export const MODERATION_FIRST_BLOCK = testContract
  ? Number(testContract[2])
  : 11605462

/** The contract's rules, mirrored to check an action before it is signed: update them with the contract. */
export const MODERATOR_STAKE = 1000000
export const MAX_VOUCHES = 5
export const MAX_REASON_BYTES = 280
export const MAX_BAN_EPOCHS = 65535
export const MAX_TRANSACTION_BATCH = 100

const ADDRESS = /^0x[0-9a-f]{40}$/
const HASH = /^0x[0-9a-f]{64}$/

/** A hex text lowercase with its 0x, or '' when it is no hex. */
export function normalHex(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  const hex = text.startsWith('0x') ? text : `0x${text}`
  return /^0x([0-9a-f]{2})*$/.test(hex) ? hex : ''
}

/** The bytes of a 0x hex text, or null (a missing argument included). */
const bytesOf = (hex) => {
  if (typeof hex !== 'string') return null
  const clean = normalHex(hex)
  if (clean === '') return null
  const digits = clean.slice(2)
  const bytes = new Uint8Array(digits.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

const readAddress = (hex) => {
  const value = normalHex(hex)
  return ADDRESS.test(value) ? value : null
}

const readHash = (hex) => {
  const value = normalHex(hex)
  return HASH.test(value) ? value : null
}

/** A little-endian unsigned number of at most `size` bytes ("0x" is 0), or null. */
const readUint = (hex, size) => {
  const bytes = bytesOf(hex)
  if (!bytes || bytes.length > size) return null
  let value = 0
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = value * 256 + bytes[i]
  return value
}

const readText = (hex) => {
  const bytes = bytesOf(hex)
  return bytes ? new TextDecoder().decode(bytes) : null
}

const allSet = (fields) => Object.values(fields).every((v) => v !== null)

/**
 * One event of the contract as the node gives it (`event` and its `args` as 0x hex), with `order` (the call's hash,
 * height, index and time, and the event's place in it); null for an event the app does not know or cannot read.
 */
export function decodeEvent(name, args = [], order = {}) {
  const a = args || []
  let fields
  switch (name) {
    case 'ban':
      fields = {
        address: readAddress(a[0]),
        moderator: readAddress(a[1]),
        epoch: readUint(a[2], 2),
        permanent: readUint(a[3], 1),
        endEpoch: readUint(a[4], 4),
        reason: readText(a[5]),
      }
      if (!allSet(fields)) return null
      return {...order, name, ...fields, permanent: fields.permanent !== 0}
    case 'unban':
    case 'unbanTransaction':
    case 'report':
    case 'reportTransaction': {
      const target =
        name === 'unban' || name === 'report'
          ? {address: readAddress(a[0])}
          : {hash: readHash(a[0])}
      const who = name.startsWith('report') ? 'reporter' : 'moderator'
      fields = {...target, [who]: readAddress(a[1]), reason: readText(a[2])}
      break
    }
    case 'banTransaction':
      fields = {
        hash: readHash(a[0]),
        moderator: readAddress(a[1]),
        epoch: readUint(a[2], 2),
        reason: readText(a[3]),
      }
      break
    case 'vouch':
    case 'vouchWithdrawn':
      fields = {
        address: readAddress(a[0]),
        voucher: readAddress(a[1]),
        count: readUint(a[2], 4),
      }
      break
    case 'vouchesRevoked':
      fields = {
        address: readAddress(a[0]),
        staker: readAddress(a[1]),
        count: readUint(a[2], 4),
      }
      break
    default:
      return null
  }
  return allSet(fields) ? {...order, name, ...fields} : null
}

export const byChainOrder = (a, b) =>
  a.height - b.height || a.index - b.index || a.eventIndex - b.eventIndex

/**
 * The contract's events in the calls of bcn_contractCalls asked with `events: true`, in chain order: only those of
 * accepted calls and emitted by the contract itself. A call without its `events` list comes from a node that does
 * not return them: that throws, never read as "no events".
 */
export function callEvents(calls, contract = MODERATION_CONTRACT) {
  const events = []
  for (const call of calls) {
    if (!Array.isArray(call.events))
      throw new Error('The node does not return the events of contract calls')
    // eslint-disable-next-line no-continue
    if (!call.success) continue
    call.events.forEach((event, eventIndex) => {
      if (normalHex(event.contract) !== contract) return
      const decoded = decodeEvent(event.event, event.args, {
        hash: normalHex(call.hash),
        height: call.height,
        index: call.index,
        time: call.timestamp,
        eventIndex,
      })
      if (decoded) events.push(decoded)
    })
  }
  return events.sort(byChainOrder)
}

/** The state with nothing moderated: what the app applies with Community moderation off. */
export const emptyModeration = () => ({
  bans: new Map(),
  hidden: new Map(),
  vouchers: new Map(),
  reports: [],
})

/**
 * The state the events (in chain order) leave: the accounts banned (by lowercase address: moderator, epoch,
 * permanent, endEpoch, reason, bannedAt, and `since`, where the uninterrupted ban started: its time, block height and
 * index there; a ban that replaces one still in effect keeps it), the posts hidden (by lowercase hash), who vouches for each vouched moderator, and
 * every report.
 */
export function replay(events) {
  const state = emptyModeration()
  for (const event of events) {
    switch (event.name) {
      case 'ban': {
        const previous = state.bans.get(event.address)
        const goesOn =
          previous && (previous.permanent || event.epoch < previous.endEpoch)
        state.bans.set(event.address, {
          moderator: event.moderator,
          epoch: event.epoch,
          permanent: event.permanent,
          endEpoch: event.endEpoch,
          reason: event.reason,
          bannedAt: event.time,
          since: goesOn
            ? previous.since
            : {time: event.time, height: event.height, index: event.index},
        })
        break
      }
      case 'unban':
        state.bans.delete(event.address)
        break
      case 'banTransaction':
        state.hidden.set(event.hash, {
          moderator: event.moderator,
          epoch: event.epoch,
          reason: event.reason,
          hiddenAt: event.time,
        })
        break
      case 'unbanTransaction':
        state.hidden.delete(event.hash)
        break
      case 'vouch':
        state.vouchers.set(
          event.address,
          new Set([...(state.vouchers.get(event.address) || []), event.voucher])
        )
        break
      case 'vouchWithdrawn': {
        const left = new Set(state.vouchers.get(event.address))
        left.delete(event.voucher)
        if (left.size > 0) state.vouchers.set(event.address, left)
        else state.vouchers.delete(event.address)
        break
      }
      case 'vouchesRevoked':
        state.vouchers.delete(event.address)
        break
      case 'report':
      case 'reportTransaction':
        state.reports.push({
          hash: event.hash,
          kind: event.name === 'report' ? 'address' : 'post',
          target: event.name === 'report' ? event.address : event.hash,
          reporter: event.reporter,
          reason: event.reason,
          time: event.time,
        })
        break
      default:
    }
  }
  return state
}

/** Whether a ban is in effect in `epoch`; while the epoch is not known (null), every ban counts. */
export const banActive = (ban, epoch) =>
  Boolean(ban) && (ban.permanent || epoch == null || epoch < ban.endEpoch)

/** The ban in effect on an address, or null. */
export function activeBan(state, address, epoch) {
  const ban = state.bans.get(normalHex(address))
  return banActive(ban, epoch) ? ban : null
}

/** Who vouches for an address: empty when it is no vouched moderator. */
export const vouchersOf = (state, address) => [
  ...(state.vouchers.get(normalHex(address)) || []),
]
