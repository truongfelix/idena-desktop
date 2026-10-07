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
