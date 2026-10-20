// Group chats with a shared key (notes/group-chat-design.md in the workspace; the phone app's SocialGroups.kt, the
// same format), on idena.social's sendMessage call. A key message hands the group's key, name and members to each
// member: one part per member, encrypted by the node (social_encrypt), the admin's own first. A group message is ONE
// part, encrypted with the group's key (AES-256-GCM, `iv(12) || ciphertext+tag`, base64), the same size whatever the
// group's size. The website drops both: it reads only messages of two parts or more, and a key message's hash is the
// first part's, never its text's.

import {decryptAesGcm, encryptAesGcm, fromBase64, toBase64} from './aes'
import {keccak256Hex} from './keccak'

/** The format's version, in every plain text. */
export const GROUP_FORMAT = 1

/** The most members of a group besides its admin: the node encrypts one message for at most 64 keys. */
export const MAX_GROUP_MEMBERS = 64

/** The longest group name. */
export const MAX_GROUP_NAME = 40

/**
 * The blocks after a member change during which a removed member's message under the older key still counts: one
 * written before they saw the change.
 */
export const GROUP_GRACE_BLOCKS = 30

/** A block before the first group could be sent (the phone app's GROUPS_FROM): no group call is older. */
export const GROUPS_FROM = 11460000

/** A group's line that is a key message (`kind`; its `text` is the group's name). */
export const KEY_LINE = 'key'

const GROUP_ID = /^[0-9a-f]{32}$/
const MEMBER = /^0x[0-9a-f]{40}$/

/** A group's conversation key: its admin and id. Never a conversationKey (those hold no ':'). */
export const groupConversationKey = (admin, group) => `g:${admin}:${group}`

/** Whether `key` is a group's conversation (groupConversationKey). */
export const isGroupKey = (key) => String(key).startsWith('g:')

const randomBytes = (size) => crypto.getRandomValues(new Uint8Array(size))

/** A new group's id: 16 random bytes, hex. */
export const newGroupId = () =>
  Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('')

/** A new group key: 32 random bytes, base64. */
export const newGroupKey = () => toBase64(randomBytes(32))

/** The plain text of a key message: the same for every member, each gets it encrypted for their own key. */
export const groupKeyPlain = (admin, group, keyId, key, name, members) =>
  JSON.stringify({
    idenaGroup: GROUP_FORMAT,
    type: 'key',
    admin,
    group,
    keyId,
    key,
    name,
    members,
  })

/** The plain text of a group message under key `keyId`. */
export const groupMessagePlain = (admin, group, keyId, text) =>
  JSON.stringify({
    idenaGroup: GROUP_FORMAT,
    type: 'message',
    admin,
    group,
    keyId,
    text,
  })

/** `plain` encrypted with the group's `key` (base64): `iv(12) || ciphertext+tag`, base64 (one part). */
export const encryptGroupPart = async (plain, key) =>
  toBase64(await encryptAesGcm(plain, key))

/** A group part opened with `key`; null when it is not for that key. */
export async function decryptGroupPart(part, key) {
  const bytes = fromBase64(part)
  return bytes ? decryptAesGcm(bytes, key) : null
}

/** The hash our group calls carry: the first part's, so that no reader can match it to a plain text. */
export const groupMessageHash = (parts) => keccak256Hex(parts[0])

function parseJson(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

const isFormat = (json, type) =>
  json?.idenaGroup === GROUP_FORMAT && json.type === type

const str = (value) => (typeof value === 'string' ? value : '')

/**
 * `call` as a key message for `me`: the plain text the node opened from `indexes` (exactly `me`'s part), from the
 * admin it names, one part per member, the admin first, distinct members `me` among them, a 32-byte key. A key:
 * {hash, height, time, index, admin, group, keyId, key, name, members}; null otherwise.
 */
export function acceptGroupKey(call, plain, indexes, me) {
  if (call.messageHash !== groupMessageHash(call.parts)) return null
  const json = parseJson(plain)
  if (!isFormat(json, 'key')) return null
  const {admin, group, keyId, key, members} = json
  if (admin !== call.from || typeof group !== 'string' || !GROUP_ID.test(group))
    return null
  if (!Number.isInteger(keyId) || keyId < 0) return null
  if (typeof key !== 'string' || fromBase64(key)?.length !== 32) return null
  if (!Array.isArray(members) || members.some((m) => typeof m !== 'string'))
    return null
  if (
    members.length !== call.parts.length ||
    members.length > MAX_GROUP_MEMBERS + 1 ||
    members[0] !== admin
  )
    return null
  if (
    members.some((m) => !MEMBER.test(m)) ||
    new Set(members).size !== members.length
  )
    return null
  const mine = members.indexOf(me)
  if (mine < 0 || (indexes || []).join(',') !== String(mine)) return null
  return {
    hash: call.hash,
    height: call.height,
    time: call.time,
    index: call.index,
    admin,
    group,
    keyId,
    key,
    name: str(json.name).trim().slice(0, MAX_GROUP_NAME),
    members,
  }
}

/** A key's group conversation (groupConversationKey). */
export const keyConversation = (key) =>
  groupConversationKey(key.admin, key.group)

/**
 * `call` as a group message under `key`: one part that `key` opens, naming its group and key, from one of the key's
 * members, with a text; null otherwise. A message as messages.js's acceptMessage gives, with its `group`.
 */
export async function acceptGroupMessage(call, key) {
  if (
    call.parts.length !== 1 ||
    call.messageHash !== groupMessageHash(call.parts)
  )
    return null
  const plain = await decryptGroupPart(call.parts[0], key.key)
  if (plain == null) return null
  const json = parseJson(plain)
  if (!isFormat(json, 'message')) return null
  if (
    json.admin !== key.admin ||
    json.group !== key.group ||
    json.keyId !== key.keyId
  )
    return null
  if (!key.members.includes(call.from)) return null
  const text = str(json.text)
  if (text === '') return null
  return {
    hash: call.hash,
    height: call.height,
    time: call.time,
    index: call.index,
    from: call.from,
    participants: key.members,
    text,
    textPassword: '',
    hasMedia: false,
    isReply: false,
    group: keyConversation(key),
  }
}

/** A key message as a line of its conversation: who changed the group, and its members and name then. */
export const keyLine = (key) => ({
  hash: key.hash,
  height: key.height,
  time: key.time,
  index: key.index,
  from: key.admin,
  participants: key.members,
  text: key.name,
  textPassword: '',
  hasMedia: false,
  isReply: false,
  group: keyConversation(key),
  kind: KEY_LINE,
})

const byChainOrder = (a, b) => a.height - b.height || a.index - b.index

/**
 * The lines of one group, in chain order: its key messages (`keys`, each a line) and the messages read under them
 * (`messages`), without a message from a member removed more than GROUP_GRACE_BLOCKS blocks before it. A key message
 * counts only with a key id not below the last one. {lines, state}: state is the group's last key, or null.
 */
export function groupLines(keys, messages) {
  const keyByHash = new Map(keys.map((key) => [key.hash, key]))
  const seen = new Set()
  const events = [...keys.map(keyLine), ...messages]
    .filter(({hash}) => !seen.has(hash) && seen.add(hash))
    .sort(byChainOrder)
  let state = null
  const removedAt = new Map()
  const lines = []
  // Whether `event`, a message, counts: from a member of the group now, or from one removed at most
  // GROUP_GRACE_BLOCKS blocks before it.
  const counts = (event) => {
    if (!state || state.members.includes(event.from)) return true
    const removed = removedAt.get(event.from)
    return removed !== undefined && event.height <= removed + GROUP_GRACE_BLOCKS
  }
  for (const event of events) {
    const key = keyByHash.get(event.hash)
    if (!key) {
      if (counts(event)) lines.push(event)
    } else if (!state || key.keyId >= state.keyId) {
      if (state)
        state.members
          .filter((m) => !key.members.includes(m))
          .forEach((m) => removedAt.set(m, key.height))
      key.members.forEach((m) => removedAt.delete(m))
      state = key
      lines.push(event)
    }
  }
  return {lines, state}
}

/**
 * The groups of `keys` with their `messages` (groupLines), as conversations for `me`: {key, others (its members,
 * `me` left out), messages, last, isRequest, isGroup, group (its last key)}. One waits in Requests until `me` wrote
 * in it or its admin is followed or marked to message, as a stranger's conversation.
 */
export function groupConversations(messages, keys, me, people) {
  const byGroup = new Map()
  for (const key of keys) {
    const id = keyConversation(key)
    if (!byGroup.has(id)) byGroup.set(id, [])
    byGroup.get(id).push(key)
  }
  return [...byGroup.entries()]
    .map(([id, groupKeys]) => {
      const {lines, state} = groupLines(
        groupKeys,
        messages.filter(({group}) => group === id)
      )
      if (!state || lines.length === 0) return null
      let others = state.members.filter((m) => m !== me)
      if (others.length === 0) others = [me]
      const known =
        state.admin === me ||
        Boolean(people[state.admin]?.following || people[state.admin]?.message)
      return {
        key: id,
        others,
        messages: lines,
        last: lines[lines.length - 1],
        isGroup: true,
        isRequest:
          !known && !lines.some(({from, kind}) => from === me && !kind),
        group: state,
      }
    })
    .filter(Boolean)
}

/**
 * A key line as what changed against `previous` (the key line before it, or null): {kind: 'created' | 'addedYou'}
 * for the first one `me` holds (the older keys never reach a new member), else a list of {kind: 'added' | 'removed',
 * who} and {kind: 'renamed', name}, or [{kind: 'newKey'}] when only the key is new.
 */
export function groupEvent(line, previous, me) {
  if (!previous) return [{kind: line.from === me ? 'created' : 'addedYou'}]
  const changes = []
  const added = line.participants.filter(
    (m) => !previous.participants.includes(m)
  )
  const removed = previous.participants.filter(
    (m) => !line.participants.includes(m)
  )
  if (added.length > 0) changes.push({kind: 'added', who: added})
  if (removed.length > 0) changes.push({kind: 'removed', who: removed})
  if (line.text !== previous.text)
    changes.push({kind: 'renamed', name: line.text})
  return changes.length > 0 ? changes : [{kind: 'newKey'}]
}

/** By line hash: the key line before it in `lines` (groupEvent reads a change against it). */
export function previousKeyLines(lines) {
  const previous = {}
  let last = null
  for (const line of lines) {
    previous[line.hash] = last
    if (line.kind === KEY_LINE) last = line
  }
  return previous
}
