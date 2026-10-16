// A post's image as the phone app makes it (SocialImage.kt): WebP at quality 75, the longer side at one of a few
// sizes, turned upright from its EXIF orientation. Encoding drops the photo's details (place, camera).

import {IMAGE_TYPE} from './posting'

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
