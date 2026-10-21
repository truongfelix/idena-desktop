import {
  addressOfPublicKey,
  messageCode,
  messageCodeFor,
  parseMessageCode,
} from './message-code'
import {findPublicKey, keysToAsk} from './messages'

// Ported from the phone app's MessageCodeTest.kt. The key and its address are the node library's
// (mobile.PrivateKeyPublicKey and crypto.PubkeyToAddress) for one private key.
const key =
  '044e3b81af9c2234cad09d679ce6035ed1392347ce64ce405f5dcd36228a25de6e47fd35c4215d1edf53e6f83de344615ce719bdb0fd878f6ed76f06dd277956de'
const address = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23'

describe('the message code', () => {
  it('a key hashes to its address', () => {
    expect(addressOfPublicKey(key)).toBe(address.toLowerCase())
  })

  it('reads back with or without its prefix, spaces or case', () => {
    const code = messageCode(key)
    expect(code).toBe(`idena-key:${key}`)
    expect(parseMessageCode(code)).toBe(key)
    const wrapped = `  ${code
      .toUpperCase()
      .replace('IDENA-KEY:', 'idena-key:')
      .match(/.{1,20}/g)
      .join('\n')} `
    expect(parseMessageCode(wrapped)).toBe(key)
    expect(parseMessageCode(`0x${key}`)).toBe(key)
    expect(parseMessageCode(key.slice(2))).toBe(key)
    expect(parseMessageCode(address)).toBeNull()
    // 128 characters are a key without its 04 (taken, then checked against the address); 126 are none.
    expect(parseMessageCode(key.slice(0, -4))).toBeNull()
    expect(parseMessageCode(`05${key.slice(2)}`)).toBeNull()
    expect(parseMessageCode(`${key.slice(0, -1)}g`)).toBeNull()
  })

  it('is taken only for its own address', () => {
    expect(
      messageCodeFor(
        messageCode(key),
        address.toUpperCase().replace('0X', '0x')
      )
    ).toBe(key)
    expect(messageCodeFor(messageCode(key), `0x${'1'.repeat(40)}`)).toBeNull()
    // One digit changed in the key: another key, another address.
    const changed = key.slice(0, -1) + (key.endsWith('0') ? '1' : '0')
    expect(messageCodeFor(messageCode(changed), address)).toBeNull()
  })

  it('gives the key to write to an account that never signed anything', async () => {
    const lower = address.toLowerCase()
    const none = {identityKey: async () => '', keysAt: async () => ({})}
    expect(await findPublicKey(lower, none)).toBeNull()
    expect(
      await findPublicKey(lower, {...none, sharedKeys: {[lower]: key}})
    ).toBe(key)
  })

  it('is made only of a whole key: a compressed one gives none', () => {
    expect(parseMessageCode(`02${key.slice(2, 66)}`)).toBeNull()
  })
})

describe('the keys to look up', () => {
  it('are each asked once at a time, never when known', () => {
    const asking = new Set(['0xb'])
    expect(
      keysToAsk(
        ['0xA', '0xa', '0xb', '0xc', '0xd'],
        {'0xc': '', '0xd': key},
        asking
      )
    ).toEqual(['0xa'])
  })
})
