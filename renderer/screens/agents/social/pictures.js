import {ipfsCid} from '../../social/calls'

// The pictures of the posts a Social run reads (B-293), as the model is shown them: each one read from the post
// (inline base64) or through the app's own node (ipfs_get), drawn on a canvas at most PICTURE_SIDE on its longer
// side, on white, and sent as JPEG. The image is decoded from its bytes (createImageBitmap), never fetched from a
// blob: address (the window's rules refuse it). A picture that cannot be read is null: the post keeps its placeholder.

/** The longer side of a picture as the model is shown it: about 1,000 input tokens at most. */
export const PICTURE_SIDE = 1024
/** The largest picture read. */
export const MAX_PICTURE_SOURCE = 20 * 1000 * 1000
/** How long the node may look for a picture on IPFS, and how many are read at once. */
export const PICTURE_TIMEOUT_MS = 30 * 1000
const AT_ONCE = 4
const QUALITY = 0.85

/** The bytes of a hex text from ipfs_get, or null. */
function hexBytes(hex) {
  if (!hex || hex === '0x') return null
  const clean = String(hex).replace(/^0x/, '')
  if (clean.length % 2 || !/^[0-9a-f]*$/i.test(clean)) return null
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return bytes
}

/** The bytes of a post's media: inline base64, or "ipfs://<cid>" read through the node (`rpc`). */
export async function mediaBytes(media, rpc) {
  const cid = ipfsCid(media)
  if (cid) return hexBytes(await rpc('ipfs_get', [cid], PICTURE_TIMEOUT_MS))
  if (String(media).startsWith('ipfs://')) return null
  const text = atob(String(media).replace(/\s/g, ''))
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i)
  return bytes
}

/** The width and height of a picture drawn with its longer side at most `side`. */
export function fittedSize(width, height, side = PICTURE_SIDE) {
  const factor = Math.min(1, side / Math.max(width, height))
  return [
    Math.max(1, Math.round(width * factor)),
    Math.max(1, Math.round(height * factor)),
  ]
}

function base64(bytes) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** The picture of `bytes` (its type `mediaType`) as the model is shown it: {mediaType: 'image/jpeg', data}. */
export async function modelPicture(bytes, mediaType) {
  const bitmap = await createImageBitmap(new Blob([bytes], {type: mediaType}))
  try {
    const [width, height] = fittedSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    // A transparent picture on white, as the Social screen shows it (JPEG has no transparency).
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', QUALITY)
    })
    if (!blob || blob.type !== 'image/jpeg') return null
    return {
      mediaType: 'image/jpeg',
      data: base64(new Uint8Array(await blob.arrayBuffer())),
    }
  } finally {
    if (bitmap.close) bitmap.close()
  }
}

/** One post's picture for the model, or null when it cannot be read (no node has it, too large, not a picture). */
export async function loadPicture(
  media,
  mediaType,
  {rpc, draw = modelPicture}
) {
  try {
    const bytes = await mediaBytes(media, rpc)
    if (!bytes || !bytes.length || bytes.length > MAX_PICTURE_SOURCE)
      return null
    return await draw(bytes, mediaType)
  } catch (error) {
    global.logger?.warn('agent: a post picture not read', error?.message)
    return null
  }
}

/** The pictures `wanted` (a Map media -> type) loaded with `load`, a few at once: a Map media -> picture, those read. */
export async function loadPictures(wanted, load) {
  const entries = [...wanted.entries()]
  const out = new Map()
  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const [media, mediaType] = entries[next]
      next += 1
      // eslint-disable-next-line no-await-in-loop
      const picture = await load(media, mediaType)
      if (picture) out.set(media, picture)
    }
  }
  await Promise.all(
    Array.from({length: Math.min(AT_ONCE, entries.length)}, worker)
  )
  return out
}
