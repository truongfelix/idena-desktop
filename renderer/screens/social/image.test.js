import {
  MAX_PICTURE_BYTES,
  defaultSide,
  imageSides,
  isShowablePicture,
  scaledSize,
  squareCrop,
} from './image'

describe('image sizes', () => {
  it('offers the sizes the image can fill, and its own when it is smaller', () => {
    expect(imageSides(4000)).toEqual([320, 480, 720, 1080])
    expect(imageSides(720)).toEqual([320, 480, 720])
    expect(imageSides(200)).toEqual([200])
  })

  it('starts at 480 when offered, else at the largest', () => {
    expect(defaultSide([320, 480, 720])).toBe(480)
    expect(defaultSide([320])).toBe(320)
    expect(defaultSide([200])).toBe(200)
  })

  it('scales the longer side and never enlarges', () => {
    expect(scaledSize(4000, 3000, 480)).toEqual([480, 360])
    expect(scaledSize(3000, 4000, 480)).toEqual([360, 480])
    expect(scaledSize(200, 100, 480)).toEqual([200, 100])
    expect(scaledSize(5000, 1, 320)).toEqual([320, 1])
  })
})

describe('profile pictures (Q-48)', () => {
  /** A WebP header of `size` bytes: simple (VP8), or extended (VP8X) with `flags`. */
  const webp = (size, chunk = 'VP8 ', flags = 0) => {
    const bytes = new Uint8Array(size)
    bytes.set(Buffer.from('RIFF'), 0)
    bytes.set(Buffer.from('WEBP'), 8)
    bytes.set(Buffer.from(chunk), 12)
    bytes[20] = flags
    return bytes
  }

  it('shows a still WebP of at most 32 KB', () => {
    expect(isShowablePicture(webp(5000))).toBe(true)
    expect(isShowablePicture(webp(MAX_PICTURE_BYTES))).toBe(true)
    expect(isShowablePicture(webp(5000, 'VP8X', 0x10))).toBe(true)
  })

  it('refuses a larger file, an animated WebP, another format or nothing', () => {
    expect(isShowablePicture(webp(MAX_PICTURE_BYTES + 1))).toBe(false)
    expect(isShowablePicture(webp(5000, 'VP8X', 0x02))).toBe(false)
    const gif = new Uint8Array(5000)
    gif.set(Buffer.from('GIF89a'), 0)
    expect(isShowablePicture(gif)).toBe(false)
    expect(isShowablePicture(null)).toBe(false)
  })

  it('crops the centered square', () => {
    expect(squareCrop(400, 300)).toEqual([50, 0, 300])
    expect(squareCrop(300, 401)).toEqual([0, 50, 300])
  })
})
