// The adversarial noise of a flip picture, effect by effect (B-213): the Protect step shows a control for each, and
// Regenerate draws them at random. Never weaker than the noise always sent: a grain of at least 20% and a colour
// shift of at least 20 degrees; the brightness is the picture editor's, not the noise's (owner 2026-11-10, B-217, as
// the phone's B-215). Pure functions on RGBA pixel arrays.
const convert = require('color-convert')

// Each effect's limits, and the automatic noise's top (it draws from `min` to `automaticMax`).
export const NOISE_LIMITS = {
  grain: {min: 20, max: 40, automaticMax: 30}, // % of the outline pixels recoloured from the picture's palette
  hue: {min: 20, max: 60, automaticMax: 60}, // degrees of colour shift
}

const clamp = (value, {min, max}) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

// The automatic noise's effects: mirrored half the time, a grain of 20 to 30%, a colour shift of 20 to 60 degrees.
export function randomNoiseEffects(random = Math.random) {
  const draw = ({min, automaticMax}) =>
    min + Math.floor(random() * (automaticMax - min + 1))
  return {
    mirror: Math.floor(random() * 2) === 0,
    grain: draw(NOISE_LIMITS.grain),
    hue: draw(NOISE_LIMITS.hue),
  }
}

// Effects read from a control or a saved value: each within its limits. A brightness saved by an earlier build
// (B-213) is not read: the noise has none.
export function noiseEffects(effects) {
  const {mirror, grain, hue} = effects || {}
  return {
    mirror: Boolean(mirror),
    grain: clamp(grain, NOISE_LIMITS.grain),
    hue: clamp(hue, NOISE_LIMITS.hue),
  }
}

// Whether a picture's saved noise keeps the rules: none saved (a build before B-213 always drew 20% and 20 to 49
// degrees), or values within the limits and no brightness (B-213's master builds allowed less, and a brightness).
export function isNoiseWithinRules(effects) {
  if (effects === null || effects === undefined) return true
  const {grain, hue, brightness} = effects
  const within = (value, {min, max}) =>
    Number.isFinite(value) && value >= min && value <= max
  return (
    within(grain, NOISE_LIMITS.grain) &&
    within(hue, NOISE_LIMITS.hue) &&
    (brightness === undefined || brightness === 100)
  )
}

// A saved draft's protected pictures and their noise, as the Protect step takes them: dropped when one picture's noise
// breaks the rules (L-64), so that the step protects the pictures again with the automatic noise.
export function draftProtection({protectedImages, noise}) {
  const kept = !Array.isArray(noise) || noise.every(isNoiseWithinRules)
  return kept
    ? {protectedImages, noise}
    : {
        protectedImages: Array.from({length: 4}),
        noise: Array.from({length: 4}),
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
