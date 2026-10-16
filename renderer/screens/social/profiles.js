import {nextPageToken} from './calls'

// The profiles contract (idena-profile): one unique name, a short bio and a picture per identity in good standing,
// Trust (a public vouch counted per person and per topic) and vouched members. Read with contract_readMap and
// contract_iterateMap, every value a string; written with contract calls, each with one JSON argument.

/**
 * A test network's copy of the contract, given when the app starts: IDENA_PROFILE_CONTRACT=<address>. Mainnet's is
 * not deployed yet: without it, the app shows no profiles.
 */
const testContract = /^(0x[0-9a-fA-F]{40})$/.exec(
  global.env?.IDENA_PROFILE_CONTRACT || ''
)

export const PROFILE_CONTRACT = testContract ? testContract[1] : null

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

/**
 * Whether an address is in good standing: a validated identity, or a member vouched for by one ([voucherState]).
 * Out of good standing, the apps hide its name, bio, picture and Trusts (Q-47).
 */
export const inStanding = (state, voucherState = null) =>
  isValidated(state) || (voucherState !== null && isValidated(voucherState))

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
 * The givers of Trust to `target` (an address, or "r/<topic>"), each {address, epoch, vouched}, from the contract
 * map "t:<target>:" (contract_iterateMap, 100 a page).
 */
export async function trustGivers(call, target, contract = PROFILE_CONTRACT) {
  const givers = []
  const seen = new Set()
  let token = null
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await call('contract_iterateMap', [
      contract,
      `t:${String(target).toLowerCase()}:`,
      token,
      'string',
      'string',
      100,
    ])
    for (const {key, value} of page?.items || []) {
      const [epoch, mark] = String(value).split(':')
      givers.push({
        address: String(key).toLowerCase(),
        epoch: Number(epoch),
        vouched: mark === 'v',
      })
    }
    token = nextPageToken(page?.continuationToken)
    if (token !== null && seen.has(token))
      throw new Error('contract_iterateMap repeats its pages')
    if (token !== null) seen.add(token)
  } while (token !== null)
  return givers
}

/**
 * Which givers count now, as the apps count Trust: an identity in a trusting state, or a vouched member in good
 * standing. `states` by lowercase address (the givers' and their vouchers'), `vouchers` the members' vouchers.
 * Returns the counted givers and the counts: by identities, and by vouched members ("Trusted by 12 (+3 vouched)").
 */
export function countTrust(givers, states, vouchers = {}) {
  const counted = givers.filter(({address, vouched}) => {
    if (!vouched) return isTrusting(states[address])
    const voucher = vouchers[address]
    return Boolean(voucher) && inStanding(states[address], states[voucher])
  })
  return {
    counted,
    identities: counted.filter((g) => !g.vouched).length,
    vouched: counted.filter((g) => g.vouched).length,
  }
}

/** The Trust of `target` as the apps show it: its givers read, their states and vouchers, counted. */
export async function readTrust(call, settled, target) {
  const givers = await trustGivers(call, target)
  const members = givers.filter((g) => g.vouched).map((g) => g.address)
  const voucherValues = members.length
    ? await readEntries(
        settled,
        members.map((m) => ['v:', m])
      )
    : []
  const vouchers = {}
  members.forEach((m, i) => {
    if (voucherValues[i]) vouchers[m] = voucherValues[i].toLowerCase()
  })
  const states = givers.length
    ? await identityStates(settled, [
        ...givers.map((g) => g.address),
        ...Object.values(vouchers),
      ])
    : {}
  return {givers, ...countTrust(givers, states, vouchers)}
}

/** A call to the profiles contract, as the sending path takes it: method, its JSON argument, the amount sent. */
export const ProfileCall = {
  claimName: (name) => profileCall('claimName', {name}),
  dropName: () => profileCall('dropName', null),
  setProfile: (bio, picture) => profileCall('setProfile', {bio, picture}),
  trust: (target) => profileCall('trust', {target}),
  untrust: (target) => profileCall('untrust', {target}),
}

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

/** `call` (a profile call) asking `gas` for its callback (its argument's "_gas"); unchanged without an argument or a gas. */
export const withCallbackGas = (call, gas) =>
  gas === null || call.argument === null
    ? call
    : {
        ...call,
        argument: JSON.stringify({
          ...JSON.parse(call.argument),
          _gas: gas,
        }),
      }
