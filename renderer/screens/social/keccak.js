/* global BigInt */
// Keccak-256 (the original padding 0x01, not SHA3-256's 0x06), as js-sha3's keccak256 that idena.social uses for
// a message's messageHash: the phone app's Keccak.kt, with 64-bit lanes as BigInt (messages are small).

const MASK = BigInt('0xffffffffffffffff')

const ROUND_CONSTANTS = [
  '0x0000000000000001',
  '0x0000000000008082',
  '0x800000000000808A',
  '0x8000000080008000',
  '0x000000000000808B',
  '0x0000000080000001',
  '0x8000000080008081',
  '0x8000000000008009',
  '0x000000000000008A',
  '0x0000000000000088',
  '0x0000000080008009',
  '0x000000008000000A',
  '0x000000008000808B',
  '0x800000000000008B',
  '0x8000000000008089',
  '0x8000000000008003',
  '0x8000000000008002',
  '0x8000000000000080',
  '0x000000000000800A',
  '0x800000008000000A',
  '0x8000000080008081',
  '0x8000000000008080',
  '0x0000000080000001',
  '0x8000000080008008',
].map(BigInt)

/** The rotation of each lane (x + 5y) in the rho step. */
const ROTATIONS = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18,
  2, 61, 56, 14,
].map(BigInt)

const RATE = 136
const B64 = BigInt(64)
const B8 = BigInt(8)
const BFF = BigInt(0xff)

/* eslint-disable no-bitwise */
const rotl = (lane, n) => ((lane << n) | (lane >> (B64 - n))) & MASK

function keccakF(a) {
  const c = new Array(5)
  const b = new Array(25)
  for (let round = 0; round < 24; round += 1) {
    for (let x = 0; x < 5; x += 1)
      c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], BigInt(1))
      for (let y = 0; y < 25; y += 5) a[y + x] ^= d
    }
    for (let x = 0; x < 5; x += 1)
      for (let y = 0; y < 5; y += 1)
        b[y + 5 * ((2 * x + 3 * y) % 5)] =
          ROTATIONS[x + 5 * y] === BigInt(0)
            ? a[x + 5 * y]
            : rotl(a[x + 5 * y], ROTATIONS[x + 5 * y])
    for (let y = 0; y < 25; y += 5)
      for (let x = 0; x < 5; x += 1)
        a[y + x] =
          b[y + x] ^ (~b[y + ((x + 1) % 5)] & MASK & b[y + ((x + 2) % 5)])
    a[0] ^= ROUND_CONSTANTS[round]
  }
}

/** The Keccak-256 hash of `data` (a Uint8Array). */
export function keccak256(data) {
  const state = new Array(25).fill(BigInt(0))
  const padded = new Uint8Array((Math.floor(data.length / RATE) + 1) * RATE)
  padded.set(data)
  padded[data.length] ^= 0x01
  padded[padded.length - 1] ^= 0x80
  for (let block = 0; block < padded.length; block += RATE) {
    for (let i = 0; i < RATE / 8; i += 1) {
      let lane = BigInt(0)
      for (let j = 7; j >= 0; j -= 1)
        lane = (lane << B8) | BigInt(padded[block + 8 * i + j])
      state[i] ^= lane
    }
    keccakF(state)
  }
  return Uint8Array.from({length: 32}, (_, i) =>
    Number((state[Math.floor(i / 8)] >> (B8 * BigInt(i % 8))) & BFF)
  )
}
/* eslint-enable no-bitwise */

/** `text`'s Keccak-256 in lowercase hex, without 0x (js-sha3's keccak256 of a string: its UTF-8 bytes). */
export const keccak256Hex = (text) =>
  Array.from(keccak256(new TextEncoder().encode(text)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
