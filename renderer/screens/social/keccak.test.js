import {keccak256Hex} from './keccak'
import vectors from './keccak.test-vectors.json'

describe('keccak256', () => {
  // Hashes written by @noble/hashes' keccak_256 (sizes around the 136-byte rate, a message's JSON): the phone
  // app's test vectors.
  it('matches @noble/hashes', () => {
    expect(vectors).toHaveLength(7)
    for (const {text, keccak256} of vectors)
      expect([text.length, keccak256Hex(text)]).toEqual([
        text.length,
        keccak256,
      ])
  })

  it('hashes the empty text as everyone does', () => {
    expect(keccak256Hex('')).toBe(
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
    )
  })
})
