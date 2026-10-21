// The message code (the phone app's MessageCode.kt, the same format): an account's public key, shared by its owner,
// so that anyone can write to it before it signed a transaction (an address alone does not give the key: it is a hash
// of it). "idena-key:" then the 65 bytes in hex, uncompressed (04, X, Y), as the node gives an identity's key. A code
// is used only for the address it hashes to.

import {keccak256} from './keccak'

/** What a message code starts with. */
export const MESSAGE_CODE_PREFIX = 'idena-key:'

/** The message code of the public key `publicKey` (hex of its 65 uncompressed bytes, "0x" optional). */
export const messageCode = (publicKey) =>
  MESSAGE_CODE_PREFIX + String(publicKey).replace(/^0x/, '').toLowerCase()

/**
 * The public key a message code `text` holds (any case, spaces and line breaks left out, with or without its prefix
 * and "0x"), as 130 lowercase hex characters starting with 04; null when it holds none. 64 bytes without the 04 are
 * taken too.
 */
export function parseMessageCode(text) {
  let hex = String(text ?? '')
    .replace(/\s/g, '')
    .toLowerCase()
  if (hex.startsWith(MESSAGE_CODE_PREFIX))
    hex = hex.slice(MESSAGE_CODE_PREFIX.length)
  if (hex.startsWith('0x')) hex = hex.slice(2)
  if (!/^[0-9a-f]*$/.test(hex)) return null
  if (hex.length === 130 && hex.startsWith('04')) return hex
  if (hex.length === 128) return `04${hex}`
  return null
}

/** The address (lowercase, "0x") of the uncompressed public key `publicKey` (130 hex): the last 20 bytes of the Keccak-256 of X and Y. */
export function addressOfPublicKey(publicKey) {
  const hex = publicKey.slice(2)
  const bytes = Uint8Array.from({length: hex.length / 2}, (_, i) =>
    parseInt(hex.substr(i * 2, 2), 16)
  )
  return `0x${Array.from(keccak256(bytes).slice(12), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')}`
}

/** The public key in the message code `text` when it is `address`'s (any case); null for another account's or none. */
export function messageCodeFor(text, address) {
  const key = parseMessageCode(text)
  return key && addressOfPublicKey(key) === String(address).toLowerCase()
    ? key
    : null
}
