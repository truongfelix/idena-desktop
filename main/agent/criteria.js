// Whose posts, answers and messages an agent reads, and whom it acts on (B-266, owner 2026-11-16: "the idea is to have
// custom in what Idena ecosystem can do"). A read action on others holds `who`, an action on others `onlyTo`: the
// same criteria, each one set or not, the person combines them. The renderer reads each author and applies them
// (renderer/screens/agents/criteria.js); here each field is checked as it is saved.

/** The identity states a criterion can pick: Vouched is the profiles contract's vouched member, the others the chain's. */
const STATES = [
  'Vouched',
  'Candidate',
  'Newbie',
  'Verified',
  'Human',
  'Zombie',
  'Suspended',
]

/** The read actions on what others wrote (`who`) and the actions on others (`onlyTo`). */
const WHO_ACTIONS = [
  'readPosts',
  'readNotifications',
  'readMessages',
  'readTags',
]
const ONLY_TO_ACTIONS = ['reply', 'like', 'message', 'tip']

const MAX_ADDRESSES = 200
const MAX_WORDS = 50
// As Social's hidden words (renderer hiding.js MAX_HIDDEN_WORD): a longer one would be cut there and never match.
const MAX_WORD_LENGTH = 60
const ADDRESS = /^0x[0-9a-f]{40}$/u
// A topic's name, as Social takes it (renderer/screens/social/contract.js TOPIC_NAME).
const TOPIC = /^[a-z0-9_]{3,21}$/u
const MAX_TOPICS = 50
/** How often an action may be done for one author (B-281): once a day or once a week. */
const PER_AUTHOR = ['day', 'week']

const topics = (value) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((one) =>
          String(one || '')
            .trim()
            .toLowerCase()
            .replace(/^r\//u, '')
        )
        .filter((one) => TOPIC.test(one))
    ),
  ].slice(0, MAX_TOPICS)

const addresses = (value) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((one) =>
          String(one || '')
            .trim()
            .toLowerCase()
        )
        .filter((one) => ADDRESS.test(one))
    ),
  ].slice(0, MAX_ADDRESSES)

const words = (value) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((one) =>
          String(one || '')
            .trim()
            .toLowerCase()
            .slice(0, MAX_WORD_LENGTH)
        )
        .filter(Boolean)
    ),
  ].slice(0, MAX_WORDS)

/** A number from 0 (`whole`: a whole one), or null for none. */
function atLeast(value, whole) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  if (whole && !Number.isInteger(number)) return null
  return number
}

/**
 * The criteria as saved, each field checked; null when none is set (the action reads or acts as without criteria).
 * `withWords`: the words the text must or must not hold (reads only). B-281: `named` (only authors with a claimed
 * profile name) and, with the words, `topics` (only posts in these topics); each is kept only when set, so criteria
 * saved before read the same.
 */
function normalizeCriteria(value, {withWords = false} = {}) {
  if (!value || typeof value !== 'object') return null
  const criteria = {
    only: addresses(value.only),
    except: addresses(value.except),
    states: STATES.filter(
      (state) => Array.isArray(value.states) && value.states.includes(state)
    ),
    trustAbove: atLeast(value.trustAbove, true),
    minAge: atLeast(value.minAge, true),
    minStake: atLeast(value.minStake, false),
    ...(withWords
      ? {mustWords: words(value.mustWords), notWords: words(value.notWords)}
      : {}),
    ...(value.named === true ? {named: true} : {}),
    ...(withWords && topics(value.topics).length
      ? {topics: topics(value.topics)}
      : {}),
  }
  const set =
    criteria.only.length ||
    criteria.except.length ||
    criteria.states.length ||
    criteria.trustAbove !== null ||
    criteria.minAge !== null ||
    criteria.minStake !== null ||
    criteria.named ||
    criteria.topics ||
    (withWords && (criteria.mustWords.length || criteria.notWords.length))
  return set ? criteria : null
}

/** The criteria field of an action's row (`who`, `onlyTo`), checked; {} when the action has none or none is set. */
function criteriaField(name, row) {
  if (WHO_ACTIONS.includes(name)) {
    const who = normalizeCriteria(row.who, {withWords: true})
    return who ? {who} : {}
  }
  if (ONLY_TO_ACTIONS.includes(name)) {
    const onlyTo = normalizeCriteria(row.onlyTo)
    return {
      ...(onlyTo ? {onlyTo} : {}),
      // Once per author a day or a week (B-281), kept only when set.
      ...(PER_AUTHOR.includes(row.perAuthor) ? {perAuthor: row.perAuthor} : {}),
      // A private message only to who wrote to it first (B-281).
      ...(name === 'message' && row.onlyAnswers === true
        ? {onlyAnswers: true}
        : {}),
    }
  }
  return {}
}

module.exports = {
  ONLY_TO_ACTIONS,
  PER_AUTHOR,
  STATES,
  WHO_ACTIONS,
  criteriaField,
  normalizeCriteria,
}
