import {
  NOISE_LIMITS,
  applyBrightness,
  applyGrain,
  applyHue,
  noiseEffects,
  randomNoiseEffects,
} from './noise'

const convert = require('color-convert')

// A seeded random sequence, the same for two runs.
function seeded(seed) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

function pixelsOf(n, seed) {
  const next = seeded(seed)
  return Uint8ClampedArray.from({length: n * 4}, (_, i) =>
    i % 4 === 3 ? 255 : Math.floor(next() * 256)
  )
}

const palette = [
  {red: 10, green: 20, blue: 30},
  {red: 200, green: 100, blue: 50},
  {red: 0, green: 255, blue: 128},
]

/* eslint-disable prefer-destructuring, no-nested-ternary */
// The noise before B-213, copied verbatim from protectFlipImage (Math.random given as `random`).
function oldMergeMeshPixels(pixels, mesh, random) {
  for (let i = 0; i < pixels.length; i += 4) {
    const isRecolor = random() * 100 + 1 < 21
    const isWhite = mesh[i] > 0 && mesh[i + 1] > 0 && mesh[i + 2] > 0
    if (isRecolor && isWhite) {
      const newColorId =
        palette.length === 1
          ? 0
          : Math.floor(random() * (palette.length - 1)) + 1
      pixels[i] = palette[newColorId].red
      pixels[i + 1] = palette[newColorId].green
      pixels[i + 2] = palette[newColorId].blue
    }
  }
}

function oldModifyImageHue(pixels, rnd) {
  for (let i = 0; i < pixels.length; i += 4) {
    const hsvImage = convert.rgb.hsv(pixels[i], pixels[i + 1], pixels[i + 2])
    const newRgbImage = convert.hsv.rgb(
      hsvImage[0] + rnd,
      hsvImage[1],
      hsvImage[2]
    )
    pixels[i] = newRgbImage[0]
    pixels[i + 1] = newRgbImage[1]
    pixels[i + 2] = newRgbImage[2]
  }
}

/* eslint-enable prefer-destructuring, no-nested-ternary */

describe('the automatic noise is unchanged (B-213)', () => {
  it('grain at 20% recolours exactly the pixels the old noise did', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const mesh = pixelsOf(2000, seed + 100).map((v, i) =>
        i % 4 === 3 || v > 100 ? 255 : 0
      )
      const before = pixelsOf(2000, seed)
      const oldPixels = before.slice()
      const newPixels = before.slice()
      oldMergeMeshPixels(oldPixels, mesh, seeded(seed + 7))
      applyGrain(newPixels, mesh, palette, 20, seeded(seed + 7))
      expect(newPixels).toEqual(oldPixels)
    }
  })

  it('the colour shift turns every pixel as the old one, for each of its values', () => {
    for (let rnd = 20; rnd <= 49; rnd += 1) {
      const before = pixelsOf(500, rnd)
      const oldPixels = before.slice()
      const newPixels = before.slice()
      oldModifyImageHue(oldPixels, rnd)
      applyHue(newPixels, rnd)
      expect(newPixels).toEqual(oldPixels)
    }
  })

  it('random effects are drawn as before: mirrored half the time, 20% grain, a shift of 20 to 49, no brightness change', () => {
    const next = seeded(3)
    const seen = {mirror: new Set(), hue: new Set()}
    for (let i = 0; i < 2000; i += 1) {
      const e = randomNoiseEffects(next)
      seen.mirror.add(e.mirror)
      seen.hue.add(e.hue)
      expect(e.grain).toBe(20)
      expect(e.brightness).toBe(100)
      expect(e.hue).toBeGreaterThanOrEqual(20)
      expect(e.hue).toBeLessThanOrEqual(49)
    }
    expect([...seen.mirror].sort()).toEqual([false, true])
    expect(seen.hue.size).toBe(30)
  })
})

describe('each effect at its bounds', () => {
  const mesh = new Uint8ClampedArray(400).fill(255)

  it('grain 0 changes nothing, grain 100 recolours every outline pixel and only those', () => {
    const before = pixelsOf(100, 5)
    const none = before.slice()
    applyGrain(none, mesh, palette, 0, seeded(1))
    expect(none).toEqual(before)

    const halfMesh = mesh.map((v, i) => (Math.floor(i / 4) % 2 ? 0 : v))
    const all = before.slice()
    applyGrain(all, halfMesh, palette, 100, seeded(1))
    for (let i = 0; i < all.length; i += 4) {
      const recoloured = palette.some(
        (c) =>
          c.red === all[i] && c.green === all[i + 1] && c.blue === all[i + 2]
      )
      if ((i / 4) % 2) {
        expect([all[i], all[i + 1], all[i + 2]]).toEqual([
          before[i],
          before[i + 1],
          before[i + 2],
        ])
      } else expect(recoloured).toBe(true)
    }
  })

  it('grain without a palette changes nothing', () => {
    const before = pixelsOf(50, 9)
    const pixels = before.slice()
    applyGrain(pixels, mesh, [], 40, seeded(1))
    expect(pixels).toEqual(before)
  })

  it('a colour shift of 0 changes nothing', () => {
    const before = pixelsOf(100, 11)
    const pixels = before.slice()
    applyHue(pixels, 0)
    expect(pixels).toEqual(before)
  })

  it('brightness 100 changes nothing, 50 halves, 150 brightens within 255', () => {
    const before = Uint8ClampedArray.from([200, 100, 10, 255])
    const same = before.slice()
    applyBrightness(same, 100)
    expect([...same]).toEqual([200, 100, 10, 255])
    const darker = before.slice()
    applyBrightness(darker, 50)
    expect([...darker]).toEqual([100, 50, 5, 255])
    const brighter = before.slice()
    applyBrightness(brighter, 150)
    expect([...brighter]).toEqual([255, 150, 15, 255])
  })
})

describe('noiseEffects', () => {
  it('keeps each value within its limits', () => {
    expect(
      noiseEffects({mirror: 1, grain: 99, hue: -5, brightness: 1000})
    ).toEqual({
      mirror: true,
      grain: NOISE_LIMITS.grain.max,
      hue: NOISE_LIMITS.hue.min,
      brightness: NOISE_LIMITS.brightness.max,
    })
  })

  it('reads nothing as no noise and an unchanged brightness', () => {
    for (const none of [null, undefined, {}]) {
      expect(noiseEffects(none)).toEqual({
        mirror: false,
        grain: 0,
        hue: 0,
        brightness: 100,
      })
    }
  })
})
