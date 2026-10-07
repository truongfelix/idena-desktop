import {ipfsCid} from './utils'

// The Social contacts, kept on this computer only: a private name for an address, shown instead of the address in
// the Social tab, and two marks: Following (their posts in the feed's Following filter) and Message (private
// conversations, to come). Nothing is published. The same format as the phone app's people.json, so that a list
// exported on one imports on the other.

export const MAX_NAME = 40
export const PEOPLE_VERSION = 1

/** The shortest query searched in the texts. */
export const MIN_SEARCH = 2

const ADDRESS = /^0x[0-9a-f]{40}$/i

export const isSocialAddress = (value) => ADDRESS.test(String(value || ''))

export const shortAddress = (address) =>
  `${String(address).slice(0, 6)}…${String(address).slice(-4)}`

/** The first n UTF-16 units of a text, one less when the last would split an emoji (a surrogate pair). */
export function takeWhole(text, n) {
  const cut = text.slice(0, n)
  const last = cut.charCodeAt(cut.length - 1)
  return cut.length === n && last >= 0xd800 && last <= 0xdbff
    ? cut.slice(0, -1)
    : cut
}

const isControl = (c) => {
  const code = c.charCodeAt(0)
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

/** A text as a name: one line, no control characters, trimmed, at most MAX_NAME characters. */
export function cleanName(text) {
  const oneLine = Array.from(String(text || ''), (c) =>
    isControl(c) ? ' ' : c
  )
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
  return takeWhole(oneLine, MAX_NAME).trim()
}

/** A contact: address lowercase, name empty when not named. */
export const person = (
  address,
  {name = '', following = false, message = false} = {}
) => ({
  address: String(address).toLowerCase(),
  name,
  following,
  message,
})

const isEmptyPerson = ({name, following, message}) =>
  name === '' && !following && !message

/** The list (by address) with a contact put in, or taken out once it has no name and no mark. */
export function withPerson(people, next) {
  const result = {...people}
  if (isEmptyPerson(next)) delete result[next.address]
  else result[next.address] = next
  return result
}

/** The contacts in name order: named ones first, by name ignoring case, then by address. */
export function sortedPeople(people) {
  return Object.values(people).sort(
    (a, b) =>
      (a.name === '') - (b.name === '') ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      a.address.localeCompare(b.address)
  )
}

export const peopleToJson = (people) => ({
  version: PEOPLE_VERSION,
  people: sortedPeople(people).map(({address, name, following, message}) => ({
    address,
    name,
    following,
    message,
  })),
})

/** The list from its JSON (the phone's export too); entries that are not valid are left out. */
export function peopleFromJson(json) {
  let people = {}
  for (const entry of Array.isArray(json?.people) ? json.people : []) {
    if (entry && isSocialAddress(entry.address))
      people = withPerson(
        people,
        person(entry.address, {
          name: cleanName(entry.name),
          following: entry.following === true,
          message: entry.message === true,
        })
      )
  }
  return people
}

/** The names of the list, by lowercase address. */
export const peopleNames = (people) =>
  Object.fromEntries(
    Object.values(people)
      .filter(({name}) => name !== '')
      .map(({address, name}) => [address, name])
  )

/** How an address shows: its contact name, else shortened. */
export const displayName = (address, names) =>
  names[String(address).toLowerCase()] || shortAddress(address)

/** The posts of the feed whose author is followed. */
export const followingFeed = (feed, people) =>
  feed.filter(({call}) => people[call.author]?.following === true)

/**
 * What a query finds, in this order: the address it is, the contacts whose name (or address) has it, then the
 * posts, replies and comments whose text has it, newest first, at most `limit`. A text on IPFS is searched when
 * ipfsText(cid) has it (fetched already). Hits: {kind: 'address', address} | {kind: 'person', person} |
 * {kind: 'text', node, threadId}.
 */
export function searchSocial(
  feed,
  people,
  query,
  ipfsText = () => null,
  limit = 200
) {
  const q = String(query || '').trim()
  if (q.length < MIN_SEARCH) return []
  const hits = []
  if (isSocialAddress(q)) hits.push({kind: 'address', address: q.toLowerCase()})
  const lower = q.toLowerCase()
  for (const one of sortedPeople(people)) {
    const byAddress =
      lower.startsWith('0x') &&
      lower.length >= 4 &&
      one.address.startsWith(lower)
    if (one.name.toLowerCase().includes(lower) || byAddress)
      hits.push({kind: 'person', person: one})
  }
  const texts = []
  const visit = (node, threadId) => {
    const {message} = node.call
    const cid = ipfsCid(message)
    let text = null
    if (cid) text = ipfsText(cid)
    else if (!message.startsWith('ipfs://')) text = message
    if (text && text.toLowerCase().includes(lower))
      texts.push({kind: 'text', node, threadId})
    node.replies.forEach((reply) => visit(reply, threadId))
  }
  feed.forEach((node) => visit(node, node.id))
  texts.sort(
    (a, b) =>
      b.node.call.height - a.node.call.height ||
      b.node.call.index - a.node.call.index
  )
  return hits.concat(texts.slice(0, limit))
}

/**
 * The list with an exported one merged in, without losing anything: a name from the file replaces the one here
 * (an empty one keeps it), and a mark set on either side stays set. {added, changed, people}.
 */
export function mergePeople(current, imported) {
  let people = current
  let added = 0
  let changed = 0
  for (const one of Object.values(imported)) {
    const old = people[one.address]
    const merged = old
      ? person(one.address, {
          name: one.name || old.name,
          following: old.following || one.following,
          message: old.message || one.message,
        })
      : one
    if (!old) added += 1
    else if (
      merged.name !== old.name ||
      merged.following !== old.following ||
      merged.message !== old.message
    )
      changed += 1
    people = withPerson(people, merged)
  }
  return {added, changed, people}
}
