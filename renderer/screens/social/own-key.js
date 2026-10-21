// The account's own public key before its first transaction, for its message code: the node signs a fixed text
// (dna_sign; the signature is never sent anywhere) and the key is recovered from the signature, as any ECDSA
// signature gives the key that made it. It works with every node, built-in or external: the private key stays in
// the node. A key is kept only when it gives back the account's address.

import {secp256k1} from '@noble/curves/secp256k1.js'
import {keccak256} from './keccak'
import {addressOfPublicKey} from './message-code'
import {socialRpc} from './node'

/** The text the node signs; nothing reads the signature but this file. */
export const OWN_KEY_TEXT = "Idena desktop: this account's message code"

const hexBytes = (hex) => {
  const clean = String(hex ?? '').replace(/^0x/, '')
  if (!/^([0-9a-fA-F]{2})*$/.test(clean)) return null
  return Uint8Array.from({length: clean.length / 2}, (_, i) =>
    parseInt(clean.substr(i * 2, 2), 16)
  )
}

const bytesHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The public key (130 lowercase hex, 04 X Y) that made the node's signature `signature` of `text`, or null.
 * The node signs the Keccak-256 of the Keccak-256 of the text (dna_sign's default "doubleHash") and gives r, s and the
 * recovery byte (0 or 1) last.
 */
export function publicKeyOfSignature(text, signature) {
  const bytes = hexBytes(signature)
  if (!bytes || bytes.length !== 65) return null
  const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64]
  if (recovery > 1) return null
  const recovered = new Uint8Array(65)
  recovered[0] = recovery
  recovered.set(bytes.slice(0, 64), 1)
  const hash = keccak256(keccak256(new TextEncoder().encode(text)))
  try {
    const key = secp256k1.recoverPublicKey(recovered, hash, {prehash: false})
    return bytesHex(secp256k1.Point.fromBytes(key).toBytes(false))
  } catch {
    return null
  }
}

/** `address`'s public key, from its node's signature; null when the node does not sign or signs with another key. */
export async function ownPublicKey(address, call = socialRpc) {
  const signature = await call('dna_sign', [OWN_KEY_TEXT])
  const key = publicKeyOfSignature(OWN_KEY_TEXT, signature)
  return key && addressOfPublicKey(key) === String(address).toLowerCase()
    ? key
    : null
}
