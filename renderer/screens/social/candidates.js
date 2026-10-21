// Starting a conversation or choosing a group's members, as the phone app's SocialNewChat.kt: the people of the
// People list, those already written with and every account the app knows a name of, found by name or address as it
// is typed; a whole address typed, the holder of a name claimed in the profiles contract (with or without its "@"),
// or the account of a message code pasted, followed or not.

import {isSocialAddress, peopleNames, sortedPeople} from './people'
import {PROFILE_NAME} from './profiles'

/** Whether `address`'s name or address holds `query` (any case, a leading "@" left out); every address matches a blank query. */
function matches(address, query, names) {
  const q = String(query).trim().toLowerCase().replace(/^@/, '')
  if (q === '' || address.includes(q)) return true
  const name = names[address]
  return Boolean(name && name.toLowerCase().replace(/^@/, '').includes(q))
}

/**
 * The name `query` holds when it can be one claimed in the profiles contract ("@name" or "name"), lowercase without
 * its "@"; else null.
 */
export function claimableName(query) {
  const name = String(query ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
  return PROFILE_NAME.test(name) ? name : null
}

/**
 * Who a new conversation can be with, for `query` (lowercase addresses): a whole address typed first, then `found`
 * (the holder of the name typed, or the account of a message code), then the people of the one-to-one conversations
 * (the latest first), then the People list in name order, then, for a query that is not blank, the other accounts
 * `known` names (by lowercase address: the names shown, claimed ones included) whose name or address holds it; never
 * `me`, each once.
 */
export function chatCandidates(
  query,
  {people = {}, conversations = [], me = '', known = {}, found = null} = {}
) {
  const names = {...known, ...peopleNames(people)}
  const trimmed = String(query ?? '')
    .trim()
    .toLowerCase()
  const typed = isSocialAddress(trimmed) ? trimmed : null
  const listed = conversations
    .filter(({isGroup}) => !isGroup)
    .map((conversation) => conversation.others[0])
    .concat(sortedPeople(people).map(({address}) => address))
  const others =
    trimmed === ''
      ? []
      : Object.keys(known).sort((x, y) =>
          String(known[x])
            .toLowerCase()
            .localeCompare(String(known[y]).toLowerCase())
        )
  const lowerMe = String(me).toLowerCase()
  return [
    ...new Set([
      ...[typed, found && found.toLowerCase()].filter(Boolean),
      ...listed.concat(others).filter((a) => matches(a, query, names)),
    ]),
  ].filter((address) => address !== lowerMe)
}

/** The most people found shown at once below the members chosen. */
export const MAX_FOUND_ROWS = 50

/**
 * The rows of a group's editor: every member `chosen` (up to 64: each can be unticked), then at most `limit` of the
 * people `found` not chosen.
 */
export const editRows = (chosen, found, limit = MAX_FOUND_ROWS) => [
  ...chosen,
  ...found.filter((address) => !chosen.includes(address)).slice(0, limit),
]
