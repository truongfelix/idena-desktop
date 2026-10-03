/**
 * The robot avatars of Idena (robohash.idena.io), drawn by the app from its own pictures, as the phone app
 * does: RoboHash's set1 ported from e1ven/Robohash (robohash.py, MIT), the pictures in
 * renderer/public/static/robohash (see CREDITS.txt there). RoboHash hashes the text with SHA-512, cuts the
 * 128 hex digits into 11 numbers of 11 digits, and takes the color from the first and one picture of each
 * part from the 5th to the 9th (the 2nd to the 4th pick a set and a background, unused here).
 */

/** The colors of set1, in RoboHash's (natural) order. */
export const ROBOHASH_COLORS = [
  'blue',
  'brown',
  'green',
  'grey',
  'orange',
  'pink',
  'purple',
  'red',
  'white',
  'yellow',
]

/** The parts in RoboHash's order of choice (mouth, eyes, accessory, body, face), each with 10 pictures. */
export const ROBOHASH_PARTS = 5
export const ROBOHASH_VARIANTS = 10

// The order to draw the parts in: body, face, accessory, eyes, mouth (RoboHash sorts by the name after '#').
const LAYERS = [3, 4, 2, 1, 0]

/** The robot of a SHA-512 digest (128 hex digits): its color and the picture of each part. */
export function robotOfDigest(hex) {
  const block = Math.floor(hex.length / 11)
  const numbers = Array.from({length: 11}, (_, i) =>
    parseInt(hex.slice(i * block, (i + 1) * block), 16)
  )
  return {
    color: ROBOHASH_COLORS[numbers[0] % ROBOHASH_COLORS.length],
    parts: Array.from(
      {length: ROBOHASH_PARTS},
      (_, i) => numbers[4 + i] % ROBOHASH_VARIANTS
    ),
  }
}

/** The pictures of a robot, in the order to draw them. */
export function robotLayers({color, parts}) {
  return LAYERS.map(
    (part) => `/static/robohash/${color}/${part}/${parts[part]}.png`
  )
}

const robots = new Map()

/** The robot of `text` (the lowercase address, as robohash.idena.io was asked), kept while the app runs. */
export async function robot(text) {
  if (robots.has(text)) return robots.get(text)
  const digest = await global.crypto.subtle.digest(
    'SHA-512',
    new TextEncoder().encode(text)
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  const result = robotOfDigest(hex)
  robots.set(text, result)
  return result
}

/** The robot of `text` when already computed, else undefined. */
export function cachedRobot(text) {
  return robots.get(text)
}
