// The adversarial noise of a flip picture, effect by effect (B-213): the Protect step shows a control for each, and
// Regenerate draws them at random as before. Pure functions on RGBA pixel arrays.
const convert = require('color-convert')

export const NOISE_LIMITS = {
  grain: {min: 0, max: 40}, // % of the outline pixels recoloured from the picture's palette
  hue: {min: 0, max: 60}, // degrees of colour shift
  brightness: {min: 50, max: 150}, // % of the picture's brightness
}

const clamp = (value, {min, max}) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

// The effects as the automatic noise always chose them: mirrored half the time, 20% grain, a colour shift of 20 to
// 49 degrees, the brightness unchanged.
export function randomNoiseEffects(random = Math.random) {
  return {
    mirror: Math.floor(random() * 2) === 0,
    grain: 20,
    hue: Math.floor(random() * 30) + 20,
    brightness: 100,
  }
}

// Effects read from a control or a saved value: each within its limits.
export function noiseEffects(effects) {
  const {mirror, grain, hue, brightness} = effects || {}
  return {
    mirror: Boolean(mirror),
    grain: clamp(grain, NOISE_LIMITS.grain),
    hue: clamp(hue, NOISE_LIMITS.hue),
    brightness: clamp(brightness ?? 100, NOISE_LIMITS.brightness),
  }
}

// Grain: each outline pixel (white in `mesh`) is recoloured, with the chance `percent`, by a colour of `palette`.
export function applyGrain(
  pixels,
  mesh,
  palette,
  percent,
  random = Math.random
) {
  if (!palette.length || percent <= 0) return
  for (let i = 0; i < pixels.length; i += 4) {
    // One draw per pixel, outline or not, as the noise always drew them.
    const roll = random() * 100
    const isOutline = mesh[i] > 0 && mesh[i + 1] > 0 && mesh[i + 2] > 0
    if (isOutline && roll < percent) {
      const color =
        palette.length === 1
          ? palette[0]
          : palette[Math.floor(random() * (palette.length - 1)) + 1]
      pixels[i] = color.red
      pixels[i + 1] = color.green
      pixels[i + 2] = color.blue
    }
  }
}

// Colour shift: every pixel's hue turned by `degrees`.
export function applyHue(pixels, degrees) {
  if (!degrees) return
  for (let i = 0; i < pixels.length; i += 4) {
    const [h, s, v] = convert.rgb.hsv(pixels[i], pixels[i + 1], pixels[i + 2])
    const [r, g, b] = convert.hsv.rgb(h + degrees, s, v)
    pixels[i] = r
    pixels[i + 1] = g
    pixels[i + 2] = b
  }
}

// Brightness: every colour scaled by `percent` / 100, kept within 0..255.
export function applyBrightness(pixels, percent) {
  if (percent === 100) return
  const k = percent / 100
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.min(255, Math.round(pixels[i] * k))
    pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * k))
    pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * k))
  }
}
