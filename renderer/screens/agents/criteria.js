import {
  isValidated,
  isVouchable,
  readEntries,
  readTrust,
} from '../social/profiles'
import {wordFilter} from '../social/hiding'

// Whose posts, answers and messages an agent reads, and whom it acts on (B-266): the criteria the person sets on a
// read action (`who`) or an action on others (`onlyTo`), checked as saved in main/agent/criteria.js. Each author is
// read once and kept a while: its identity (state, age, stake: one dna_identity batch), whether it is a vouched member
// and its Trust (the profiles contract), only when a criterion needs them. An author that could not be read passes no
// criterion: the agent never acts on what it could not check.

/** How long an author read is kept: its state, stake and Trust change at most a few times an epoch. */
export const AUTHOR_TTL_MS = 30 * 60 * 1000
/** The most authors whose Trust one run reads (each is several contract reads). */
export const MAX_TRUST_READS = 100

const known = new Map()

/** What the criteria in `list` need read of each author: {identity, vouched, trust}. */
export function criteriaNeeds(list) {
  const needs = {identity: false, vouched: false, trust: false}
  list.filter(Boolean).forEach((one) => {
    if (one.minAge !== null || one.minStake !== null) needs.identity = true
    if (one.states.some((state) => state !== 'Vouched')) needs.identity = true
    // A vouched member is one without an identity of its own: its state is read too.
    if (one.states.includes('Vouched')) {
      needs.vouched = true
      needs.identity = true
    }
    if (one.trustAbove !== null) needs.trust = true
  })
  return needs
}

/**
 * Each address's facts ({state, age, stake, vouched, trust}, lowercase keys) as `needs` asks, from the node
 * (`settled`: a batch of one method; `call`: one call) and kept for AUTHOR_TTL_MS. A read that failed leaves that
 * fact out: the criteria that need it do not pass.
 */
export async function readAuthors(
  addresses,
  needs,
  {settled, call, now = Date.now()}
) {
  const list = [...new Set(addresses.map((a) => String(a).toLowerCase()))]
  // The expired ones go: the cache holds only what is still fresh.
  known.forEach((kept, address) => {
    if (now - kept.at >= AUTHOR_TTL_MS) known.delete(address)
  })
  const fresh = (address) => {
    const kept = known.get(address)
    return kept && now - kept.at < AUTHOR_TTL_MS ? kept.facts : null
  }
  const facts = Object.fromEntries(list.map((a) => [a, {...fresh(a)}]))
  const missing = (field) => list.filter((a) => !(field in facts[a]))
  if (needs.identity && missing('state').length) {
    const asked = missing('state')
    try {
      const answers = await settled(
        'dna_identity',
        asked.map((a) => [a])
      )
      asked.forEach((a, i) => {
        const result = answers[i] && answers[i].result
        if (!result) return
        facts[a].state = String(result.state || '')
        facts[a].age = Number(result.age) || 0
        facts[a].stake = Number(result.stake) || 0
      })
    } catch {
      // Left out: the criteria that need them do not pass.
    }
  }
  if (needs.vouched && missing('vouched').length) {
    const asked = missing('vouched')
    try {
      const vouchers = await readEntries(
        settled,
        asked.map((a) => ['v:', a])
      )
      const voucherOf = asked.map((a, i) =>
        vouchers[i] ? String(vouchers[i]).toLowerCase() : null
      )
      const asking = [...new Set(voucherOf.filter(Boolean))]
      // Each voucher's state on its own: one failed read leaves out only the members it vouches for.
      const answers = asking.length
        ? await settled(
            'dna_identity',
            asking.map((v) => [v])
          )
        : []
      const voucherState = {}
      asking.forEach((v, i) => {
        const result = answers[i] && answers[i].result
        voucherState[v] = result ? result.state || 'Undefined' : null
      })
      // A vouched member in standing, as the profiles count it: no identity of its own, its voucher validated.
      asked.forEach((a, i) => {
        const voucher = voucherOf[i]
        if (voucher === null) {
          facts[a].vouched = false
          return
        }
        if (!('state' in facts[a]) || voucherState[voucher] === null) return
        facts[a].vouched =
          isVouchable(facts[a].state) && isValidated(voucherState[voucher])
      })
    } catch {
      // Left out.
    }
  }
  if (needs.trust) {
    const asked = missing('trust').slice(0, MAX_TRUST_READS)
    for (const a of asked) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const trust = await readTrust(call, settled, a)
        facts[a].trust = trust.identities + trust.vouched
      } catch {
        // Left out.
      }
    }
  }
  // Stamped when read: a cached author's facts keep their first time, and are read again once it is past.
  list.forEach((a) => {
    const kept = known.get(a)
    known.set(a, {at: kept ? kept.at : now, facts: facts[a]})
  })
  return facts
}

// The words as Social hides them (hiding.js): whole words, accents ignored; built once per criteria.
const filters = new WeakMap()
const filtersOf = (criteria) => {
  if (!filters.has(criteria))
    filters.set(criteria, {
      must: wordFilter(criteria.mustWords || []),
      not: wordFilter(criteria.notWords || []),
    })
  return filters.get(criteria)
}

/** Forgets the authors read (a test, or the node changed). */
export const forgetAuthors = () => known.clear()

/**
 * Whether `address` (with its `facts`, readAuthors) and its `text` pass `criteria`; no criteria pass everyone. A state
 * picked passes when the author is in one of them (Vouched: a vouched member in standing); the words, whole words: one
 * of `mustWords` in the text, none of `notWords`, for an item with a text (`text` null: a like or a tip, no words).
 */
export function passes(criteria, address, facts = {}, text = null) {
  if (!criteria) return true
  const who = String(address || '').toLowerCase()
  if (criteria.only.length && !criteria.only.includes(who)) return false
  if (criteria.except.includes(who)) return false
  if (
    criteria.states.length &&
    !criteria.states.some((state) =>
      state === 'Vouched' ? facts.vouched === true : facts.state === state
    )
  )
    return false
  if (
    criteria.trustAbove !== null &&
    !(typeof facts.trust === 'number' && facts.trust > criteria.trustAbove)
  )
    return false
  if (
    criteria.minAge !== null &&
    !(typeof facts.age === 'number' && facts.age >= criteria.minAge)
  )
    return false
  if (
    criteria.minStake !== null &&
    !(typeof facts.stake === 'number' && facts.stake >= criteria.minStake)
  )
    return false
  if (text === null) return true
  const {must, not} = filtersOf(criteria)
  if (!must.isEmpty && !must.matches(String(text))) return false
  if (!not.isEmpty && not.matches(String(text))) return false
  return true
}
