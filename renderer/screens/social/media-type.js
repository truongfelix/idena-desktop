// What a post's media file is, read from its first bytes, never only from the type the post declares: a file that is
// not what it says is not played (B-222, as the phone's SocialMediaType.kt). Also what the app posts for a file sent
// as it is, and the MP4 boxes that hold where a phone video was taken, renamed so that no player reads them.

import {MAX_IPFS_FILE} from './posting'

export const MediaFormat = {
  Jpeg: 'jpeg',
  Png: 'png',
  Gif: 'gif',
  Webp: 'webp',
  AnimatedWebp: 'animated-webp',
  Bmp: 'bmp',
  Avif: 'avif',
  Heif: 'heif',
  Mp4: 'mp4',
  M4a: 'm4a',
  Webm: 'webm',
  Ogg: 'ogg',
  Mp3: 'mp3',
  Unknown: 'unknown',
}

export const MediaKind = {
  Picture: 'picture',
  Animation: 'animation',
  Video: 'video',
  Audio: 'audio',
}

const at = (bytes, offset, values) =>
  bytes.length >= offset + values.length &&
  values.every((value, i) => bytes[offset + i] === value)

const ascii = (bytes, offset, text) =>
  at(
    bytes,
    offset,
    Array.from(text, (c) => c.charCodeAt(0))
  )

const latin1 = (bytes, from, to) =>
  String.fromCharCode(...Array.from(bytes.slice(from, to)))

/** An ISO media file (an "ftyp" box first) by its major brand: AVIF and HEIF pictures, M4A sound, else MP4. */
function isoBrand(bytes) {
  const brand = bytes.length >= 12 ? latin1(bytes, 8, 12) : ''
  if (brand === 'avif' || brand === 'avis') return MediaFormat.Avif
  if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
    return MediaFormat.Heif
  if (brand === 'M4A ' || brand === 'M4B ') return MediaFormat.M4a
  return MediaFormat.Mp4
}

const containsAscii = (bytes, text, within) => {
  const last = Math.min(bytes.length, within) - text.length
  for (let i = 0; i <= last; i += 1) if (ascii(bytes, i, text)) return true
  return false
}

/** The format of `bytes` (a Uint8Array), from its first bytes. */
export function sniffFormat(bytes) {
  if (!bytes) return MediaFormat.Unknown
  if (at(bytes, 0, [0xff, 0xd8, 0xff])) return MediaFormat.Jpeg
  if (at(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return MediaFormat.Png
  if (ascii(bytes, 0, 'GIF8')) return MediaFormat.Gif
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP'))
    // An extended header (VP8X) with its animation flag is a moving picture.
    // eslint-disable-next-line no-bitwise
    return ascii(bytes, 12, 'VP8X') && bytes.length > 20 && bytes[20] & 0x02
      ? MediaFormat.AnimatedWebp
      : MediaFormat.Webp
  if (ascii(bytes, 0, 'BM')) return MediaFormat.Bmp
  if (ascii(bytes, 4, 'ftyp')) return isoBrand(bytes)
  if (at(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]))
    return containsAscii(bytes, 'webm', 64)
      ? MediaFormat.Webm
      : MediaFormat.Unknown
  if (ascii(bytes, 0, 'OggS')) return MediaFormat.Ogg
  if (ascii(bytes, 0, 'ID3')) return MediaFormat.Mp3
  // An MPEG audio frame: 11 sync bits, then a layer that is not 0 (layer 0 is AAC's ADTS).
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    // eslint-disable-next-line no-bitwise
    (bytes[1] & 0xe0) === 0xe0 &&
    // eslint-disable-next-line no-bitwise
    ((bytes[1] >> 1) & 0x03) !== 0
  )
    return MediaFormat.Mp3
  return MediaFormat.Unknown
}

const VIDEO_FORMATS = new Set([MediaFormat.Mp4, MediaFormat.Webm])
const AUDIO_FORMATS = new Set([
  MediaFormat.Mp3,
  MediaFormat.M4a,
  MediaFormat.Mp4,
  MediaFormat.Ogg,
  MediaFormat.Webm,
])

/**
 * What a post's media declared as `declaredType` is when its file `bytes` really is one: a video or a sound the app
 * plays; null when the file is something else (it is then not played) or the type is neither video nor audio.
 */
export function playableKind(declaredType, bytes) {
  const type = String(declaredType).toLowerCase()
  const format = sniffFormat(bytes)
  if (type.startsWith('video/') && VIDEO_FORMATS.has(format))
    return MediaKind.Video
  if (type.startsWith('audio/') && AUDIO_FORMATS.has(format))
    return MediaKind.Audio
  return null
}

/**
 * The type the app posts for a file sent as it is, by its `format`; `audio` when it was picked as a sound (an MP4, WebM
 * or Ogg file is then a sound, else a video). Null for a format that is not posted as it is (a still picture is
 * encoded as WebP).
 */
export function postedType(format, audio) {
  switch (format) {
    case MediaFormat.Gif:
      return 'image/gif'
    case MediaFormat.AnimatedWebp:
      return 'image/webp'
    case MediaFormat.Mp3:
      return 'audio/mpeg'
    case MediaFormat.M4a:
      return 'audio/mp4'
    case MediaFormat.Ogg:
      return 'audio/ogg'
    case MediaFormat.Mp4:
      return audio ? 'audio/mp4' : 'video/mp4'
    case MediaFormat.Webm:
      return audio ? 'audio/webm' : 'video/webm'
    default:
      return null
  }
}

/** What a post's media of `type` is, from its declared type alone. */
export function kindOfType(type) {
  const value = String(type).toLowerCase()
  if (value.startsWith('video/')) return MediaKind.Video
  if (value.startsWith('audio/')) return MediaKind.Audio
  if (value === 'image/gif') return MediaKind.Animation
  return MediaKind.Picture
}

/** What the IPFS file of a draft's media of `type` is called in a refusal: image, video or sound. */
export function mediaWhat(type) {
  const kind = kindOfType(type || '')
  if (kind === MediaKind.Video) return 'video'
  if (kind === MediaKind.Audio) return 'sound'
  return 'image'
}

/** How a picked file is posted: {still, tooLargeToMove} | {asIs: type} | {tooLarge: 'video' | 'audio'}. */
export function pickedAs(format, animated, size, audio) {
  const fits = size <= MAX_IPFS_FILE
  if (format === MediaFormat.Gif || format === MediaFormat.AnimatedWebp) {
    if (!animated) return {still: true, tooLargeToMove: false}
    return fits
      ? {asIs: postedType(format, audio)}
      : {still: true, tooLargeToMove: true}
  }
  const type = postedType(format, audio)
  if (!type) return {still: true, tooLargeToMove: false}
  if (fits) return {asIs: type}
  return {tooLarge: kindOfType(type) === MediaKind.Video ? 'video' : 'audio'}
}

// "uuid": XMP, where some cameras write the place.
const DETAIL_BOXES = new Set(['udta', 'meta', 'uuid'])
const FREE = Uint8Array.from([0x66, 0x72, 0x65, 0x65])
const PARENT_BOXES = new Set(['moov', 'trak'])

const readUInt32 = (bytes, offset) =>
  bytes[offset] * 0x1000000 +
  // eslint-disable-next-line no-bitwise
  ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])

function renameDetails(bytes, from, to) {
  let offset = from
  while (offset + 8 <= to) {
    let size = readUInt32(bytes, offset)
    let header = 8
    if (size === 0) size = to - offset
    else if (size === 1) {
      if (offset + 16 > to) return false
      size =
        readUInt32(bytes, offset + 8) * 0x100000000 +
        readUInt32(bytes, offset + 12)
      header = 16
    }
    if (size < header || offset + size > to) return false
    const type = latin1(bytes, offset + 4, offset + 8)
    const end = offset + size
    if (DETAIL_BOXES.has(type)) bytes.set(FREE, offset + 4)
    else if (
      PARENT_BOXES.has(type) &&
      !renameDetails(bytes, offset + header, end)
    )
      return false
    offset = end
  }
  return true
}

/**
 * `bytes` (an MP4 or M4A file) with its detail boxes ("udta", "meta": where a phone writes the place a video was taken)
 * renamed "free" at the top, in "moov" and in its tracks. Nothing moves, so every offset in the file stays right. A
 * file that is not an MP4 comes back unchanged; null for an MP4 whose boxes do not add up (its details cannot be
 * found, so it is not sent).
 */
export function withoutMp4Details(bytes) {
  const format = sniffFormat(bytes)
  if (format !== MediaFormat.Mp4 && format !== MediaFormat.M4a) return bytes
  const out = new Uint8Array(bytes)
  return renameDetails(out, 0, out.length) ? out : null
}
