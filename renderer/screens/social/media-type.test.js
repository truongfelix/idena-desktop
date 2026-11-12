import {
  MediaFormat,
  MediaKind,
  kindOfType,
  pickedAs,
  playableKind,
  postedType,
  sniffFormat,
  withoutMp4Details,
} from './media-type'
import {MAX_IPFS_FILE} from './posting'

const bytes = (...values) => Uint8Array.from(values)
const ascii = (text) =>
  Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0)))
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  parts.forEach((part) => {
    out.set(part, offset)
    offset += part.length
  })
  return out
}

/** An ISO box: its 32-bit size, its type, its content. */
const box = (type, ...content) => {
  const body = join(...content)
  const size = 8 + body.length
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, size)
  return join(header, ascii(type), body)
}
const ftyp = (brand) =>
  box('ftyp', ascii(brand), bytes(0, 0, 0, 0), ascii('isom'))
const webp = (chunk, flags = 0) =>
  join(
    ascii('RIFF'),
    bytes(0x24, 0, 0, 0),
    ascii('WEBP'),
    ascii(chunk),
    bytes(10, 0, 0, 0, flags, 0, 0, 0)
  )
const latin1 = (data) => String.fromCharCode(...Array.from(data))

describe('sniffFormat', () => {
  it('reads the format from the first bytes', () => {
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(MediaFormat.Jpeg)
    expect(
      sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    ).toBe(MediaFormat.Png)
    expect(sniffFormat(ascii('GIF89a'))).toBe(MediaFormat.Gif)
    expect(sniffFormat(webp('VP8 '))).toBe(MediaFormat.Webp)
    expect(sniffFormat(webp('VP8X', 0x10))).toBe(MediaFormat.Webp)
    expect(sniffFormat(webp('VP8X', 0x12))).toBe(MediaFormat.AnimatedWebp)
    expect(sniffFormat(ftyp('avif'))).toBe(MediaFormat.Avif)
    expect(sniffFormat(ftyp('avis'))).toBe(MediaFormat.Avif)
    expect(sniffFormat(ftyp('heic'))).toBe(MediaFormat.Heif)
    expect(sniffFormat(ftyp('M4A '))).toBe(MediaFormat.M4a)
    expect(sniffFormat(ftyp('isom'))).toBe(MediaFormat.Mp4)
    expect(sniffFormat(ftyp('mp42'))).toBe(MediaFormat.Mp4)
    expect(
      sniffFormat(
        join(
          bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84),
          ascii('webm')
        )
      )
    ).toBe(MediaFormat.Webm)
    expect(
      sniffFormat(join(bytes(0x1a, 0x45, 0xdf, 0xa3), ascii('matroska')))
    ).toBe(MediaFormat.Unknown)
    expect(sniffFormat(ascii('OggS'))).toBe(MediaFormat.Ogg)
    expect(sniffFormat(join(ascii('ID3'), bytes(4, 0)))).toBe(MediaFormat.Mp3)
    expect(sniffFormat(bytes(0xff, 0xfb, 0x90, 0x64))).toBe(MediaFormat.Mp3)
    // AAC in ADTS (layer 0) is not an MP3.
    expect(sniffFormat(bytes(0xff, 0xf1, 0x50, 0x80))).toBe(MediaFormat.Unknown)
    expect(sniffFormat(ascii('<svg xmlns='))).toBe(MediaFormat.Unknown)
    expect(sniffFormat(new Uint8Array(0))).toBe(MediaFormat.Unknown)
    expect(sniffFormat(null)).toBe(MediaFormat.Unknown)
  })
})

describe('playableKind', () => {
  it('plays only a file that is what the post declares', () => {
    const mp4 = ftyp('isom')
    expect(playableKind('video/mp4', mp4)).toBe(MediaKind.Video)
    expect(playableKind('Video/MP4', mp4)).toBe(MediaKind.Video)
    expect(playableKind('audio/mp4', mp4)).toBe(MediaKind.Audio)
    expect(playableKind('audio/mpeg', join(ascii('ID3'), bytes(4, 0)))).toBe(
      MediaKind.Audio
    )
    expect(playableKind('audio/ogg', ascii('OggS'))).toBe(MediaKind.Audio)
    expect(playableKind('audio/x-m4a', ftyp('M4A '))).toBe(MediaKind.Audio)
    expect(playableKind('video/mp4', ascii('OggS'))).toBeNull()
    expect(playableKind('video/mp4', ascii('GIF89a'))).toBeNull()
    expect(playableKind('audio/mpeg', ascii('<html>'))).toBeNull()
    expect(playableKind('image/gif', ascii('GIF89a'))).toBeNull()
  })
})

describe('postedType and kindOfType', () => {
  it('names a file sent as it is', () => {
    expect(postedType(MediaFormat.Gif, false)).toBe('image/gif')
    expect(postedType(MediaFormat.AnimatedWebp, false)).toBe('image/webp')
    expect(postedType(MediaFormat.Mp4, false)).toBe('video/mp4')
    expect(postedType(MediaFormat.Mp4, true)).toBe('audio/mp4')
    expect(postedType(MediaFormat.Webm, false)).toBe('video/webm')
    expect(postedType(MediaFormat.Webm, true)).toBe('audio/webm')
    expect(postedType(MediaFormat.Ogg, false)).toBe('audio/ogg')
    expect(postedType(MediaFormat.Mp3, true)).toBe('audio/mpeg')
    expect(postedType(MediaFormat.M4a, false)).toBe('audio/mp4')
    expect(postedType(MediaFormat.Jpeg, false)).toBeNull()
    expect(postedType(MediaFormat.Webp, false)).toBeNull()
    expect(postedType(MediaFormat.Unknown, true)).toBeNull()
  })

  it('reads the kind from the declared type', () => {
    expect(kindOfType('video/webm')).toBe(MediaKind.Video)
    expect(kindOfType('AUDIO/OGG')).toBe(MediaKind.Audio)
    expect(kindOfType('image/gif')).toBe(MediaKind.Animation)
    expect(kindOfType('image/webp')).toBe(MediaKind.Picture)
  })
})

describe('pickedAs', () => {
  const fits = MAX_IPFS_FILE
  const over = MAX_IPFS_FILE + 1
  it('sends a moving picture, a video or a sound as it is when it fits', () => {
    expect(pickedAs(MediaFormat.Gif, true, fits, false)).toEqual({
      asIs: 'image/gif',
    })
    expect(pickedAs(MediaFormat.AnimatedWebp, true, 1000, false)).toEqual({
      asIs: 'image/webp',
    })
    expect(pickedAs(MediaFormat.Gif, true, over, false)).toEqual({
      still: true,
      tooLargeToMove: true,
    })
    expect(pickedAs(MediaFormat.Gif, false, 1000, false)).toEqual({
      still: true,
      tooLargeToMove: false,
    })
    expect(pickedAs(MediaFormat.Mp4, false, fits, false)).toEqual({
      asIs: 'video/mp4',
    })
    expect(pickedAs(MediaFormat.Mp4, false, over, false)).toEqual({
      tooLarge: 'video',
    })
    expect(pickedAs(MediaFormat.Ogg, false, 1000, true)).toEqual({
      asIs: 'audio/ogg',
    })
    expect(pickedAs(MediaFormat.Mp3, false, over, true)).toEqual({
      tooLarge: 'audio',
    })
    expect(pickedAs(MediaFormat.Mp4, false, 1000, true)).toEqual({
      asIs: 'audio/mp4',
    })
    expect(pickedAs(MediaFormat.Jpeg, false, over, false)).toEqual({
      still: true,
      tooLargeToMove: false,
    })
    expect(pickedAs(MediaFormat.Avif, false, 1000, false)).toEqual({
      still: true,
      tooLargeToMove: false,
    })
  })
})

describe('withoutMp4Details', () => {
  it('renames the detail boxes in place', () => {
    const place = box('udta', box('©xyz', ascii('+48.85+002.35/')))
    const keys = box('meta', ascii('com.apple.quicktime.location.ISO6709'))
    const track = box(
      'trak',
      box('tkhd', bytes(1, 2, 3)),
      box('udta', ascii('track name'))
    )
    const xmp = box(
      'uuid',
      ascii('BE7ACFCB97A942E89C71999491E3AFAC<x:xmp GPS/>')
    )
    const mdat = box('mdat', bytes(7, 7, 7))
    const file = join(
      ftyp('mp42'),
      box('moov', box('mvhd', bytes(9, 9)), place, keys, track),
      xmp,
      mdat
    )
    const cleaned = withoutMp4Details(file)
    expect(cleaned.length).toBe(file.length)
    const text = latin1(cleaned)
    expect(text.includes('udta')).toBe(false)
    expect(text.includes('meta')).toBe(false)
    expect(text.includes('uuid')).toBe(false)
    expect(text.match(/free/g)).toHaveLength(4)
    expect(
      Array.from(file).filter((value, i) => value !== cleaned[i])
    ).toHaveLength(16)
    expect(Array.from(cleaned.slice(file.length - mdat.length))).toEqual(
      Array.from(mdat)
    )
    // The picked file itself is left as it was.
    expect(latin1(file).includes('udta')).toBe(true)
  })

  it('leaves a file that is not an MP4 unchanged and refuses a broken MP4', () => {
    const ogg = join(ascii('OggS'), ascii('udta'))
    expect(withoutMp4Details(ogg)).toBe(ogg)
    const broken = join(
      ftyp('isom'),
      bytes(0, 0, 0x10, 0),
      ascii('moov'),
      box('udta', ascii('x'))
    )
    // Its details cannot be found: it is not sent.
    expect(withoutMp4Details(broken)).toBeNull()
    const noDetails = join(ftyp('isom'), box('moov', box('mvhd', bytes(1))))
    expect(Array.from(withoutMp4Details(noDetails))).toEqual(
      Array.from(noDetails)
    )
  })
})
