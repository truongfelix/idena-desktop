// idena.social's private messages (the contract's sendMessage), in its own format so that our apps and the website
// read each other's (notes/social-messages.md in the workspace; the phone app's SocialMessages.kt). The plain message
// is a JSON array, encrypted once per participant (the sender first) with the participant's public key; the node
// encrypts and decrypts them (social_encrypt / social_decrypt), its key never leaving it. On chain the sender, the
// time, the size and the number of parts are public, the participants are not.

import {decryptAesGcm} from './aes'
import {acceptGroupKey, acceptGroupMessage, groupConversations} from './groups'
import {keccak256Hex} from './keccak'

/** Parts larger than this (base64 characters) are not kept: a message with one is left out. */
export const MAX_PART = 16000

/** The most parts kept (the node decrypts at most 256 at once). */
export const MAX_PARTS = 256

/** What idena.social sends with a private message (iDNA). */
export const MESSAGE_AMOUNT = '0.00002'

const HASH = /^[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-f]{40}$/

const textDecoder = new TextDecoder()

function hexToText(hex) {
  const clean = String(hex || '').replace(/^0x/, '')
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return textDecoder.decode(bytes)
}

/**
 * The message of a sendMessage call (bcn_contractCalls) from its argument ({"message": [...], "messageHash",
 * "encrypted": true}): {hash, height, time, index, from, parts, messageHash}; null when it is not encrypted, has no
 * part, or parts too large or too many. The website reads only those of 2 parts or more; one part is a group's
 * message (groups.js).
 */
export function parseMessageCall({hash, height, timestamp, index, from, args}) {
  let arg
  try {
    arg = JSON.parse(hexToText(args?.[0]))
  } catch {
    return null
  }
  if (!arg || typeof arg !== 'object' || String(arg.encrypted) !== 'true')
    return null
  const parts = arg.message
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS)
    return null
  if (
    parts.some(
      (part) =>
        typeof part !== 'string' || part === '' || part.length > MAX_PART
    )
  )
    return null
  const messageHash = String(arg.messageHash ?? '')
    .toLowerCase()
    .replace(/^0x/, '')
  if (!HASH.test(messageHash)) return null
  return {
    hash,
    height,
    time: timestamp,
    index,
    from: String(from).toLowerCase(),
    parts,
    messageHash,
  }
}

/** A conversation's key: its participants (lowercase), sorted and distinct, joined by "-". */
export const conversationKey = (participants) =>
  [...new Set(participants.map((p) => String(p).toLowerCase()))]
    .sort()
    .join('-')

/**
 * `call` as `me` (lowercase) reads it, from its decrypted `plain` text and the `indexes` of the parts the node's key
 * opened; null when the website's reader would drop it (asyncUtils.ts:840-945): a hash that does not match, as many
 * participants as parts, the sender first, lowercase addresses, no duplicate in a group, and exactly my parts
 * opened. A message: {hash, height, time, index, from, participants, text, textPassword, hasMedia, isReply}, its
 * text "ipfs://<cid>" with textPassword when on IPFS.
 */
export function acceptMessage(call, plain, indexes, me) {
  if (typeof plain !== 'string' || keccak256Hex(plain) !== call.messageHash)
    return null
  let array
  try {
    array = JSON.parse(plain)
  } catch {
    return null
  }
  if (!Array.isArray(array) || !Array.isArray(array[0])) return null
  const participants = array[0]
  if (
    participants.length !== call.parts.length ||
    participants.some((p) => typeof p !== 'string' || !ADDRESS.test(p))
  )
    return null
  if (participants[0] !== call.from) return null
  if (
    participants.length > 2 &&
    new Set(participants).size !== participants.length
  )
    return null
  const mine = participants
    .map((p, i) => (p === me ? i : -1))
    .filter((i) => i >= 0)
  const opened = [...(indexes || [])].sort((x, y) => x - y)
  if (mine.length === 0 || opened.join(',') !== mine.join(',')) return null
  const str = (value) => (typeof value === 'string' ? value : '')
  return {
    hash: call.hash,
    height: call.height,
    time: call.time,
    index: call.index,
    from: call.from,
    participants,
    text: str(array[2]),
    textPassword: str(array[3]),
    hasMedia: Array.isArray(array[5]) && array[5].length > 0,
    isReply: str(array[4]) !== '',
  }
}

/**
 * The plain message our apps send: idena.social's JSON array, as its JSON.stringify writes it: [sender,
 * ...recipients], no channel, the text, no text password, not a reply, no media, no tags.
 */
export const plainMessage = (sender, recipients, text) =>
  JSON.stringify([
    [sender, ...recipients].map((address) => address.toLowerCase()),
    '',
    text,
    '',
    '',
    [],
    [],
    '',
    [],
  ])

/** The argument of a sendMessage call: the encrypted `parts` in participant order, and the plain message's hash. */
export const sendMessageArgument = (parts, messageHash) =>
  JSON.stringify({message: parts, messageHash, encrypted: true})

/**
 * A text the website stored on IPFS: `iv(12) || ciphertext+tag` (AES-256-GCM), its key in base64. Null when it
 * does not open.
 */
export const decryptIpfsText = decryptAesGcm

const byChainOrder = (a, b) => a.height - b.height || a.index - b.index

/**
 * The conversations of `messages` for `me`, the latest first: {key, others, messages (oldest first), isRequest,
 * isGroup, last}, and those of the groups of `groupKeys` (groupConversations: with their `group`). One waits in
 * Requests until `me` wrote in it or someone in it is followed or marked to message (a contact's `message`): a
 * stranger's first message does not show among the conversations.
 */
export function conversations(messages, me, people, groupKeys = []) {
  const byKey = new Map()
  for (const message of messages) {
    // eslint-disable-next-line no-continue
    if (message.group) continue
    const key = conversationKey(message.participants)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(message)
  }
  return [...byKey.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort(byChainOrder)
      let others = key.split('-').filter((address) => address !== me)
      if (others.length === 0) others = [me]
      const known = others.some(
        (address) => people[address]?.following || people[address]?.message
      )
      return {
        key,
        others,
        messages: sorted,
        last: sorted[sorted.length - 1],
        isGroup: others.length > 1,
        isRequest: !known && !sorted.some(({from}) => from === me),
      }
    })
    .concat(
      groupConversations(
        messages.filter(({group}) => group),
        groupKeys,
        me,
        people
      )
    )
    .sort((a, b) => byChainOrder(b.last, a.last))
}

const isAfter = ({height, index}, point) =>
  height > point[0] || (height === point[0] && index > point[1])

/**
 * The unread messages of `conversation` for `me`: those from others (a group's key messages too) after `seen` ([height, index]), after `me`'s own
 * last message (answering is reading), and from `readBefore` on (a block time; null: no such limit).
 */
export function unreadMessages(conversation, me, seen, readBefore = null) {
  const mine = [...conversation.messages]
    .reverse()
    .find(({from}) => from === me)
  const after = [seen, mine && [mine.height, mine.index]]
    .filter(Boolean)
    .reduce(
      (latest, point) =>
        !latest || isAfter({height: point[0], index: point[1]}, latest)
          ? point
          : latest,
      null
    )
  return conversation.messages.filter(
    (message) =>
      message.from !== me &&
      (!after || isAfter(message, after)) &&
      (readBefore == null || message.time >= readBefore)
  )
}

/** How many messages of `conversation` are unread for `me` (`unreadMessages`). */
export const unreadCount = (conversation, me, seen, readBefore = null) =>
  unreadMessages(conversation, me, seen, readBefore).length

/**
 * A public key as the node writes it ("0x" optional), in lowercase hex without 0x; null when it is not one (33, 64
 * or 65 bytes).
 */
export function publicKeyHex(text) {
  const hex = String(text ?? '')
    .replace(/^0x/, '')
    .toLowerCase()
  return [66, 128, 130].includes(hex.length) && /^[0-9a-f]+$/.test(hex)
    ? hex
    : null
}

/** The blocks asked again for a key at most (the newest calls of the address first). */
export const KEY_LOOKUP_BLOCKS = 3

/**
 * The public key to encrypt a message for `address` (lowercase), or null when none is known: the one its owner shared
 * as a message code (`sharedKeys`, checked against the address when kept), else the one of its identity
 * (`identityKey(address)`: an address that activated an invitation), else one the scan kept from its calls
 * (`scannedKeys`), else one read again from a block where it called the contract (`callHeights`, newest first;
 * `keysAt(height)` asks the node for a block's calls and their keys). An address that never signed anything has
 * none: no message can be encrypted for it.
 */
export async function findPublicKey(
  address,
  {identityKey, scannedKeys = {}, callHeights = [], keysAt, sharedKeys = {}}
) {
  const shared = publicKeyHex(sharedKeys[address])
  if (shared) return shared
  const own = publicKeyHex(await identityKey(address))
  if (own) return own
  const scanned = publicKeyHex(scannedKeys[address])
  if (scanned) return scanned
  for (const height of callHeights.slice(0, KEY_LOOKUP_BLOCKS)) {
    // eslint-disable-next-line no-await-in-loop
    const found = publicKeyHex((await keysAt(height))[address])
    if (found) return found
  }
  return null
}

/** The messages tried at once (one batch of social_decrypt calls). */
export const DECRYPT_BATCH = 40

/**
 * What the app keeps of an account's messages: the calls tried (hashes), the messages for it, how far each
 * conversation was read (by key: [height, index] of the last message read), the groups' keys (groups.js) and the
 * one-part calls tried with all of them (`groupTried`), and the public keys shared as message codes (by lowercase
 * address, checked against it).
 */
export const emptyChatStore = () => ({
  tried: [],
  messages: [],
  seen: {},
  groupKeys: [],
  groupTried: [],
  sharedKeys: {},
})

/** How long before an account's first load on this computer its messages still show as unread: 3 days, in seconds. */
export const READ_ON_FIRST_LOAD = 3 * 24 * 60 * 60

/**
 * The store of an account seen for the first time on this computer, at `now` (seconds): its messages older than
 * `READ_ON_FIRST_LOAD` count as read (`readBefore`, a block time), so that a profile imported here does not show all
 * its past as unread. The stores saved before it have no `readBefore`: their read points stay as they were.
 */
export const firstChatStore = (now) => ({
  ...emptyChatStore(),
  readBefore: now - READ_ON_FIRST_LOAD,
})

/**
 * `store` with the calls of `calls` of 2 parts or more not tried yet decrypted by `decrypt` (a batch: for each call
 * null, or {indexes, message}) and read as `me` reads them (acceptMessage, or a group's key message,
 * acceptGroupKey); then the one-part calls opened with the groups' keys (readGroupMessages).
 */
export async function readNewMessages(store, calls, me, decrypt) {
  const tried = new Set(store.tried)
  const todo = calls.filter(
    ({hash, parts}) => parts.length > 1 && !tried.has(hash)
  )
  if (todo.length === 0) return readGroupMessages(store, calls, [])
  const messages = [...store.messages]
  const known = new Set(messages.map(({hash}) => hash))
  const knownKeys = new Set(store.groupKeys.map(({hash}) => hash))
  const newKeys = []
  for (let i = 0; i < todo.length; i += DECRYPT_BATCH) {
    const chunk = todo.slice(i, i + DECRYPT_BATCH)
    // eslint-disable-next-line no-await-in-loop
    const answers = await decrypt(chunk)
    chunk.forEach((call, j) => {
      const answer = answers?.[j]
      if (answer && !known.has(call.hash) && !knownKeys.has(call.hash)) {
        const message = acceptMessage(call, answer.message, answer.indexes, me)
        const key =
          !message && acceptGroupKey(call, answer.message, answer.indexes, me)
        if (message) messages.push(message)
        if (key) newKeys.push(key)
      }
      tried.add(call.hash)
    })
  }
  return readGroupMessages(
    {
      ...store,
      tried: [...tried],
      messages,
      groupKeys: store.groupKeys.concat(newKeys),
    },
    calls,
    newKeys
  )
}

/** The first message one of `keys` opens `call` into (acceptGroupMessage), or null. */
async function openWithKeys(call, keys) {
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    const message = await acceptGroupMessage(call, key)
    if (message) return message
  }
  return null
}

/**
 * `store` with the one-part calls of `calls` opened by one of its groups' keys (acceptGroupMessage): those not tried
 * yet with every key, and those tried before with the keys just read (`newKeys`) only.
 */
export async function readGroupMessages(store, calls, newKeys) {
  if (store.groupKeys.length === 0) return store
  const known = new Set(store.messages.map(({hash}) => hash))
  const groupTried = new Set(store.groupTried)
  const single = calls.filter(
    ({hash, parts}) => parts.length === 1 && !known.has(hash)
  )
  const todo = single.filter(({hash}) => !groupTried.has(hash))
  const before = newKeys.length
    ? single.filter(({hash}) => groupTried.has(hash))
    : []
  if (todo.length === 0 && before.length === 0) return store
  const found = []
  for (const call of todo) {
    // eslint-disable-next-line no-await-in-loop
    const message = await openWithKeys(call, store.groupKeys)
    if (message) found.push(message)
  }
  for (const call of before) {
    // eslint-disable-next-line no-await-in-loop
    const message = await openWithKeys(call, newKeys)
    if (message) found.push(message)
  }
  if (found.length === 0 && todo.length === 0) return store
  return {
    ...store,
    messages: store.messages.concat(found),
    groupTried: store.groupTried.concat(todo.map(({hash}) => hash)),
  }
}

const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * The store as saved, or an empty one when it is not one. A store of a version without groups tried their key
 * messages as messages, and failed: those are tried again (only the hashes of the messages kept stay tried).
 */
export function readChatStore(saved) {
  if (!saved || !Array.isArray(saved.tried) || !Array.isArray(saved.messages))
    return emptyChatStore()
  const withGroups = Array.isArray(saved.groupKeys)
  const kept = new Set(saved.messages.map(({hash}) => hash))
  return {
    tried: withGroups ? saved.tried : saved.tried.filter((h) => kept.has(h)),
    messages: saved.messages,
    seen: isObject(saved.seen) ? saved.seen : {},
    groupKeys: withGroups ? saved.groupKeys : [],
    groupTried: Array.isArray(saved.groupTried) ? saved.groupTried : [],
    sharedKeys: isObject(saved.sharedKeys) ? saved.sharedKeys : {},
    ...(Number.isFinite(saved.readBefore)
      ? {readBefore: saved.readBefore}
      : {}),
  }
}
