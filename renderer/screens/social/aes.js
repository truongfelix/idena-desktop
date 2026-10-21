// AES-256-GCM as idena.social writes it (WebCrypto): `iv(12) || ciphertext+tag`, the key in base64. The website's
// texts on IPFS, and our groups' messages (groups.js).

const textDecoder = new TextDecoder()

/** `bytes` as base64. */
export const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes))

/** The bytes of base64 `text`; null when it is not base64. */
export function fromBase64(text) {
  try {
    return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0))
  } catch {
    return null
  }
}

/** `plain` (a text) sealed with `keyBase64`, a fresh iv first. */
export async function encryptAesGcm(plain, keyBase64) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    fromBase64(keyBase64),
    'AES-GCM',
    false,
    ['encrypt']
  )
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {name: 'AES-GCM', iv},
      cryptoKey,
      new TextEncoder().encode(plain)
    )
  )
  const out = new Uint8Array(iv.length + sealed.length)
  out.set(iv)
  out.set(sealed, iv.length)
  return out
}

/** `bytes` opened with `keyBase64` as a text; null when it does not open. */
export async function decryptAesGcm(bytes, keyBase64) {
  try {
    const key = fromBase64(keyBase64)
    if (!key || key.length !== 32 || bytes.length < 12 + 16) return null
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      'AES-GCM',
      false,
      ['decrypt']
    )
    const plain = await crypto.subtle.decrypt(
      {name: 'AES-GCM', iv: bytes.slice(0, 12)},
      cryptoKey,
      bytes.slice(12)
    )
    return textDecoder.decode(plain)
  } catch {
    return null
  }
}
