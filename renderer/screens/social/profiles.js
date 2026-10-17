import {nextPageToken} from './calls'

// The profiles contract (idena-profile): one unique name, a short bio and a picture per identity in good standing,
// Trust (a public vouch counted per person and per topic) and vouched members. Read with contract_readMap and
// contract_iterateMap, every value a string; written with contract calls, each with one JSON argument.

/** Mainnet's contract: the build of idena-profile b49127a, deployed 2026-10-16. */
export const MAINNET_PROFILE_CONTRACT =
  '0xd558483330925f169bbe692d8ea15b2faa83c17f'

/**
 * The contract the app reads and writes: a test network's copy, given when the app starts
 * (IDENA_PROFILE_CONTRACT=<address>), else mainnet's.
 */
export function profileContract(testAddress) {
  const test = /^(0x[0-9a-fA-F]{40})$/.exec(testAddress || '')
  return test ? test[1] : MAINNET_PROFILE_CONTRACT
}

export const PROFILE_CONTRACT = profileContract(
  global.env?.IDENA_PROFILE_CONTRACT
)

/** Whether the app reads a profiles contract. */
export const profilesEnabled = PROFILE_CONTRACT !== null

/** A name: lower case letters, digits and "_", 3 to 20 characters (the contract's rule). */
export const PROFILE_NAME = /^[a-z0-9_]{3,20}$/
export const MAX_BIO = 160
export const MAX_PICTURE = 120

/** The states that may hold a name, write a profile and vouch. */
const VALIDATED = new Set(['Newbie', 'Verified', 'Human'])
/** The states whose Trust counts: the validated ones and the two that come back at the next validation. */
const TRUSTING = new Set([...VALIDATED, 'Zombie', 'Suspended'])
/** The states that may be vouched for: no identity of their own. */
const VOUCHABLE = new Set(['Undefined', 'Invite', 'Candidate', 'Killed'])

/** The maps an address's profile is read from, by field. */
const PROFILE_MAPS = {
  name: 'a:',
  bio: 'b:',
  picture: 'p:',
  trusted: 'k:',
  trustedVouched: 'w:',
  voucher: 'v:',
}

const utf8Hex = (text) =>
  `0x${Array.from(new TextEncoder().encode(text), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')}`

/** contract_readMap's answer for a key the contract never wrote. */
const isMissing = (error) => /data is nil/i.test(String(error?.message))

/**
 * The values of `entries` ([map, key] each) in one request: null for a key never written. `settled(method,
 * paramsList)` answers {result} or {error} per call (a JSON-RPC batch); any other error throws, never read as
 * "nothing".
 */
export async function readEntries(
  settled,
  entries,
  contract = PROFILE_CONTRACT
) {
  const answers = await settled(
    'contract_readMap',
    entries.map(([map, key]) => [contract, map, utf8Hex(key), 'string'])
  )
  return answers.map(({result, error}) => {
    if (!error) return result ?? null
    if (isMissing(error)) return null
    throw error
  })
}

/** Whether an identity state (dna_identity's `state`) may hold a name, alone or as a voucher. */
export const isValidated = (state) => VALIDATED.has(state)

/** Whether an identity state counts as a giver of Trust. */
export const isTrusting = (state) => TRUSTING.has(state)

/** Whether an identity state may be vouched for: no identity of its own (unknown = Undefined). */
export const isVouchable = (state) => VOUCHABLE.has(state || 'Undefined')

/**
 * Whether an address is in good standing, as the contract decides it: a validated identity, or an account without an
 * identity vouched for by a validated one ([voucherState]). A member who got an identity is out of it until it
 * validates: the contract ends its vouch. Out of good standing, the apps hide its name, bio, picture and Trusts (Q-47).
 */
export const inStanding = (state, voucherState = null) =>
  isValidated(state) ||
  (voucherState !== null && isVouchable(state) && isValidated(voucherState))

/** The identity states of `addresses` in one request, by lowercase address ("Undefined" when unknown). */
export async function identityStates(settled, addresses) {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
  const answers = await settled(
    'dna_identity',
    unique.map((a) => [a])
  )
  const states = {}
  unique.forEach((address, i) => {
    const {result, error} = answers[i]
    if (error) throw error
    states[address] = result?.state || 'Undefined'
  })
  return states
}

/**
 * The profiles of `addresses`, by lowercase address: name, bio, picture, the raw Trust counts, the voucher, and
 * whether it is in good standing (its identity state and its voucher's read now). Its fields are null when not set.
 */
export async function readProfiles(settled, addresses) {
  const list = [...new Set(addresses.map((a) => a.toLowerCase()))]
  if (list.length === 0) return {}
  const fields = Object.keys(PROFILE_MAPS)
  const values = await readEntries(
    settled,
    list.flatMap((address) =>
      fields.map((field) => [PROFILE_MAPS[field], address])
    )
  )
  const profiles = {}
  list.forEach((address, i) => {
    const profile = {address}
    fields.forEach((field, j) => {
      profile[field] = values[i * fields.length + j]
    })
    profile.trusted = Number(profile.trusted || 0)
    profile.trustedVouched = Number(profile.trustedVouched || 0)
    profiles[address] = profile
  })
  const vouchers = list.map((a) => profiles[a].voucher).filter(Boolean)
  const states = await identityStates(settled, [...list, ...vouchers])
  for (const address of list) {
    const profile = profiles[address]
    profile.state = states[address]
    profile.voucherState = profile.voucher ? states[profile.voucher] : null
    profile.inStanding = inStanding(profile.state, profile.voucherState)
  }
  return profiles
}

/**
 * The claimed names to show, by lowercase address: only those of profiles in good standing (`profiles` from
 * readProfiles).
 */
export const shownNames = (profiles) =>
  Object.fromEntries(
    Object.values(profiles)
      .filter((p) => p.name && p.inStanding)
      .map((p) => [p.address, `@${p.name}`])
  )

/** The holder of `name` (with or without its "@"), lowercase, or null when nobody holds it. */
export async function holderOf(settled, name) {
  const clean = String(name).replace(/^@/, '').toLowerCase()
  if (!PROFILE_NAME.test(clean)) return null
  const [holder] = await readEntries(settled, [['n:', clean]])
  return holder ? holder.toLowerCase() : null
}

/**
 * Every entry of the contract map whose keys start with `prefix`, the prefix cut from each key: [{key, value}], 100 a
 * page (contract_iterateMap, strings).
 */
export async function iterateEntries(
  call,
  prefix,
  contract = PROFILE_CONTRACT
) {
  const entries = []
  const seen = new Set()
  let token = null
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await call('contract_iterateMap', [
      contract,
      prefix,
      token,
      'string',
      'string',
      100,
    ])
    for (const {key, value} of page?.items || [])
      entries.push({key: String(key), value: String(value)})
    token = nextPageToken(page?.continuationToken)
    if (token !== null && seen.has(token))
      throw new Error('contract_iterateMap repeats its pages')
    if (token !== null) seen.add(token)
  } while (token !== null)
  return entries
}

/**
 * The givers of Trust to `target` (an address, or "r/<topic>"), each {address, epoch, vouched}, from the contract
 * map "t:<target>:".
 */
export async function trustGivers(call, target, contract = PROFILE_CONTRACT) {
  const entries = await iterateEntries(
    call,
    `t:${String(target).toLowerCase()}:`,
    contract
  )
  return entries.map(({key, value}) => {
    const [epoch, mark] = value.split(':')
    return {
      address: key.toLowerCase(),
      epoch: Number(epoch),
      vouched: mark === 'v',
    }
  })
}

/**
 * The Trusts `giver` gives: [{target, epoch}] (`target` an address or "r/<topic>"), from all Trusts ("t:", keys
 * "<target>:<giver>", split at the last ':'; values "<epoch>" or "<epoch>:v").
 */
export async function readTrustsGiven(
  call,
  giver,
  contract = PROFILE_CONTRACT
) {
  const me = String(giver).toLowerCase()
  const entries = await iterateEntries(call, 't:', contract)
  const given = []
  for (const {key, value} of entries) {
    const at = key.lastIndexOf(':')
    if (at > 0 && key.slice(at + 1).toLowerCase() === me)
      given.push({
        target: key.slice(0, at).toLowerCase(),
        epoch: Number(value.split(':')[0]),
      })
  }
  return given
}

/**
 * Which givers count now, as the apps count Trust: by each giver's standing now, whatever the Trust was stored as
 * (a member who validated since counts as an identity; an identity that lost it counts while vouched for). An
 * identity in a trusting state counts with the identities; an account without one, while its voucher is
 * validated, with the vouched members. `states` by lowercase address (the givers' and their vouchers'), `vouchers`
 * the givers' vouchers. Returns the counted givers ({address, vouched}: how each counts now) and the counts
 * ("Trusted by 12 (+3 vouched)").
 */
export function countTrust(givers, states, vouchers = {}) {
  const counted = []
  for (const giver of givers) {
    const state = states[giver.address]
    const voucher = vouchers[giver.address]
    if (isTrusting(state)) counted.push({...giver, vouched: false})
    else if (voucher && inStanding(state, states[voucher]))
      counted.push({...giver, vouched: true})
  }
  return {
    counted,
    identities: counted.filter((g) => !g.vouched).length,
    vouched: counted.filter((g) => g.vouched).length,
  }
}

/** The Trust of `target` as the apps show it: its givers read, their states and vouchers, counted. */
export async function readTrust(call, settled, target) {
  const givers = await trustGivers(call, target)
  if (givers.length === 0) return {givers, ...countTrust([], {})}
  const addresses = givers.map((g) => g.address)
  const voucherValues = await readEntries(
    settled,
    addresses.map((a) => ['v:', a])
  )
  const vouchers = {}
  addresses.forEach((a, i) => {
    if (voucherValues[i]) vouchers[a] = voucherValues[i].toLowerCase()
  })
  const states = await identityStates(settled, [
    ...addresses,
    ...Object.values(vouchers),
  ])
  return {givers, ...countTrust(givers, states, vouchers)}
}

/** A call to the profiles contract, as the sending path takes it: method, its JSON argument, the amount sent. */
export const ProfileCall = {
  claimName: (name) => profileCall('claimName', {name}),
  dropName: () => profileCall('dropName', null),
  setProfile: (bio, picture) => profileCall('setProfile', {bio, picture}),
  trust: (target) => profileCall('trust', {target}),
  untrust: (target) => profileCall('untrust', {target}),
  challengeName: (name) => profileCall('challengeName', {name}),
  vouch: (member) => profileCall('vouch', {member}),
  acceptVouch: (voucher) => profileCall('acceptVouch', {voucher}),
  declineOffer: (voucher) => profileCall('declineOffer', {voucher}),
  cancelOffer: (member) => profileCall('cancelOffer', {member}),
  // The member ends its own vouch with an empty `member`.
  endVouch: (member = '') => profileCall('endVouch', {member}),
}

/** A profile call sending `amount` (iDNA, a string): what a vouched member adds, burned by the contract. */
export const withAmount = (call, amount) => ({...call, amount})

function profileCall(method, arg, amount = '0') {
  return {
    contract: PROFILE_CONTRACT,
    method,
    argument: arg === null ? null : JSON.stringify(arg),
    amount,
  }
}

/** The contract's default gas for a callback (WASM gas), and the least the app asks for. */
const DEFAULT_CALLBACK_GAS = 10000000
const MIN_CALLBACK_GAS = 1000000

/**
 * The gas to ask for the callback of a call from its dry run (`receipt`): three times what the callback used, at
 * least MIN_CALLBACK_GAS, at most the contract's default; null when the call made no callback. The node reserves the
 * whole callback gas out of the call's gas limit: the default (100,000 gas) would make the max fee, which the
 * balance must cover, about ten times the fee.
 */
export function callbackGas(receipt) {
  const callbacks = (receipt?.actionResult?.subActionResults || []).filter(
    (sub) =>
      sub?.inputAction?.actionType === 1 &&
      String(sub.inputAction.method).startsWith('_') &&
      sub.inputAction.method !== '_keepState'
  )
  if (callbacks.length === 0) return null
  const used = Number(callbacks[callbacks.length - 1].gasUsed || 0)
  return Math.min(DEFAULT_CALLBACK_GAS, Math.max(MIN_CALLBACK_GAS, 3 * used))
}

/**
 * The gas to ask for each _keepState callback of a call (it keeps a state read before the one that acts) from its
 * dry run: three times the most one used, within the same bounds as callbackGas; null when it made none. The
 * contract's default (`_keepGas`) is the same 10,000,000.
 */
export function keepStateGas(receipt) {
  const keeps = (receipt?.actionResult?.subActionResults || []).filter(
    (sub) => sub?.inputAction?.method === '_keepState'
  )
  if (keeps.length === 0) return null
  const used = Math.max(...keeps.map((sub) => Number(sub.gasUsed || 0)))
  return Math.min(DEFAULT_CALLBACK_GAS, Math.max(MIN_CALLBACK_GAS, 3 * used))
}

/**
 * `call` (a profile call) asking `gas` for its callback ("_gas") and `keepGas` for each _keepState ("_keepGas"),
 * each when not null; unchanged without an argument.
 */
export function withCallbackGas(call, gas, keepGas = null) {
  if (call.argument === null || (gas === null && keepGas === null)) return call
  const argument = JSON.parse(call.argument)
  if (gas !== null) argument._gas = gas
  if (keepGas !== null) argument._keepGas = keepGas
  return {...call, argument: JSON.stringify(argument)}
}

/**
 * What a "To" field holds: {kind: 'empty'}, {kind: 'address', address} (lowercase), {kind: 'name', name} for
 * "@name" (lowercase, a valid name), or {kind: 'invalid'}.
 */
export function parseRecipient(text) {
  const value = String(text ?? '').trim()
  if (value === '') return {kind: 'empty'}
  if (/^0x[0-9a-fA-F]{40}$/.test(value))
    return {kind: 'address', address: value.toLowerCase()}
  if (value.startsWith('@')) {
    const name = value.slice(1).toLowerCase()
    if (PROFILE_NAME.test(name)) return {kind: 'name', name}
  }
  return {kind: 'invalid'}
}

/**
 * Whom a recipient (parseRecipient) sends to: an address as typed; a name's holder only while it is in good
 * standing (a hidden name can change hands); null otherwise. `resolved` = {holder, profile} for a name.
 */
export function recipientAddress(recipient, resolved) {
  if (recipient.kind === 'address') return recipient.address
  if (recipient.kind !== 'name') return null
  return resolved?.holder && resolved.profile?.inStanding
    ? resolved.holder
    : null
}
