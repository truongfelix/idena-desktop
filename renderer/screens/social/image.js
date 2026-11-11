// A post's image as the phone app makes it (SocialImage.kt): WebP at quality 75, the longer side at one of a few
// sizes, turned upright from its EXIF orientation. Encoding drops the photo's details (place, camera).

import {IMAGE_TYPE} from './posting'
import {
  MediaFormat,
  pickedAs,
  sniffFormat,
  withoutMp4Details,
} from './media-type'

/** The sizes offered for the longer side, in pixels. */
export const IMAGE_SIDES = [320, 480, 720, 1080]

/** The largest picture file read. */
export const MAX_IMAGE_SOURCE = 40000000

const QUALITY = 0.75

/** The sizes offered for an image whose longer side is `longSide`: never larger than the image. */
export function imageSides(longSide) {
  const sides = IMAGE_SIDES.filter((side) => side <= longSide)
  return sides.length > 0 ? sides : [longSide]
}

/** The size chosen first: 480 when offered, else the largest. */
export const defaultSide = (sides) =>
  sides.includes(480) ? 480 : sides[sides.length - 1]

/** The width and height of a `width` x `height` image scaled so that its longer side is `side`. */
export function scaledSize(width, height, side) {
  const factor = Math.min(1, side / Math.max(width, height))
  return [
    Math.max(1, Math.floor(width * factor)),
    Math.max(1, Math.floor(height * factor)),
  ]
}

function toWebp(bitmap, side) {
  const [width, height] = scaledSize(bitmap.width, bitmap.height, side)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob && blob.type === IMAGE_TYPE
          ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)))
          : reject(new Error('the image cannot be converted to WebP')),
      IMAGE_TYPE,
      QUALITY
    )
  })
}

/**
 * The image of `file` at each offered size: [{side, bytes}], smallest first. Throws with a reason the editor
 * shows: too large a file, or one the app cannot read.
 */
export async function encodeImage(file) {
  if (file.size > MAX_IMAGE_SOURCE)
    throw new Error('the image is larger than 40 MB')
  let bitmap
  try {
    bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'})
  } catch {
    throw new Error('this image cannot be read')
  }
  try {
    const sides = imageSides(Math.max(bitmap.width, bitmap.height))
    const out = []
    for (const side of sides) {
      // eslint-disable-next-line no-await-in-loop
      out.push({side, bytes: await toWebp(bitmap, side)})
    }
    return out
  } finally {
    bitmap.close()
  }
}

/** Whether a GIF or a WebP `bytes` moves (more than one frame), read with the browser's ImageDecoder. */
async function isAnimation(bytes, type) {
  if (typeof ImageDecoder === 'undefined') return true
  // eslint-disable-next-line no-undef
  const decoder = new ImageDecoder({data: bytes, type})
  try {
    await decoder.completed
    return decoder.tracks.selectedTrack?.frameCount > 1
  } catch {
    return false
  } finally {
    decoder.close()
  }
}

/**
 * The draft of a picked `file` (B-222; `audio`: picked as a sound): a moving picture, a video or a sound under the
 * 900 KB of one IPFS file as it is ({asIs: true, type, bytes}; an MP4 without its details), any other picture
 * encoded as WebP ({sides, side, bytes, type}; `stillInstead` when it moved but was too large). Throws with a reason
 * the editor shows.
 */
export async function pickMedia(file, {audio = false} = {}) {
  if (file.size > MAX_IMAGE_SOURCE)
    throw new Error('the file is larger than 40 MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const format = sniffFormat(bytes)
  const asSound = audio || String(file.type).startsWith('audio/')
  const moving =
    (format === MediaFormat.Gif || format === MediaFormat.AnimatedWebp) &&
    (await isAnimation(
      bytes,
      format === MediaFormat.Gif ? 'image/gif' : 'image/webp'
    ))
  const picked = pickedAs(format, moving, bytes.length, asSound)
  if (picked.asIs) {
    const sent = withoutMp4Details(bytes)
    if (!sent)
      throw new Error(
        'its parts cannot be read, so the place where it was taken cannot be removed'
      )
    return {asIs: true, type: picked.asIs, bytes: sent}
  }
  if (picked.tooLarge)
    throw new Error(
      `the ${
        picked.tooLarge === 'video' ? 'video' : 'sound'
      } is too large (${Math.floor(bytes.length / 1000)} KB, at most 900 KB)`
    )
  if (
    format === MediaFormat.Unknown &&
    (audio || /^(video|audio)\//.test(String(file.type)))
  )
    throw new Error(
      'only MP4 and WebM videos, and MP3, M4A, Ogg and WebM sounds, can be sent'
    )
  const sides = await encodeImage(file)
  const side = defaultSide(sides.map((item) => item.side))
  return {
    sides,
    side,
    bytes: sides.find((item) => item.side === side).bytes,
    type: IMAGE_TYPE,
    stillInstead: picked.tooLargeToMove ? Math.floor(bytes.length / 1000) : 0,
  }
}

/** A profile picture: square, this many pixels a side, WebP, at most MAX_PICTURE_BYTES (design note: Pictures). */
export const PICTURE_SIDE = 256
export const MAX_PICTURE_BYTES = 32000
const PICTURE_QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4]

/** The centered square of a `width` x `height` image: [x, y, side]. */
export function squareCrop(width, height) {
  const side = Math.min(width, height)
  return [Math.floor((width - side) / 2), Math.floor((height - side) / 2), side]
}

function pictureWebp(bitmap, quality) {
  const [x, y, side] = squareCrop(bitmap.width, bitmap.height)
  const out = Math.min(PICTURE_SIDE, side)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, x, y, side, side, 0, 0, out, out)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob && blob.type === IMAGE_TYPE
          ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)))
          : reject(new Error('the image cannot be converted to WebP')),
      IMAGE_TYPE,
      quality
    )
  })
}

/**
 * The profile picture of `file`: its centered square at PICTURE_SIDE, WebP, the best quality that fits in
 * MAX_PICTURE_BYTES. Throws with a reason the dialog shows.
 */
export async function encodePicture(file) {
  if (file.size > MAX_IMAGE_SOURCE)
    throw new Error('the image is larger than 40 MB')
  let bitmap
  try {
    bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'})
  } catch {
    throw new Error('this image cannot be read')
  }
  try {
    for (const quality of PICTURE_QUALITIES) {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await pictureWebp(bitmap, quality)
      if (bytes.length <= MAX_PICTURE_BYTES) return bytes
    }
    throw new Error('the picture stays above 32 KB')
  } finally {
    bitmap.close()
  }
}

const ascii = (bytes, from, to) =>
  String.fromCharCode(...Array.from(bytes.slice(from, to)))

/**
 * Whether `bytes` may show as a profile picture (Q-48): a still WebP (RIFF/WEBP, and in an extended VP8X header no
 * animation flag) of at most MAX_PICTURE_BYTES. The contract keeps only the reference: a direct call may point to
 * any file.
 */
export function isShowablePicture(bytes) {
  if (!bytes || bytes.length > MAX_PICTURE_BYTES || bytes.length < 21)
    return false
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP')
    return false
  // eslint-disable-next-line no-bitwise
  return !(ascii(bytes, 12, 16) === 'VP8X' && bytes[20] & 0x02)
}
