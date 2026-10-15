import {keccak256Hex} from './keccak'
import {
  acceptMessage,
  conversations,
  decryptIpfsText,
  findPublicKey,
  parseMessageCall,
  plainMessage,
  publicKeyHex,
  readNewMessages,
  sendMessageArgument,
  unreadCount,
  emptyChatStore,
} from './messages'
import {person} from './people'
import website from './messages.test-vectors.json'
import {a, b, c, hex} from './test-helpers'

// Ported from the phone app's SocialMessagesTest.kt and SocialMessagesScanTest.kt. The vectors are what
// idena.social's code writes (JSON.stringify, keccak_256, WebCrypto AES-GCM).

const call = (from, parts, plain, height = 10, index = 0) => ({
  hash: `0x${height}${index}`,
  height,
  time: height * 20,
  index,
  from,
  parts: Array.from({length: parts}, (_, i) => `part${i}`),
  messageHash: keccak256Hex(plain),
})

describe('private messages', () => {
  it('are written as the website writes them', () => {
    const m = website.message
    const plain = plainMessage(m.sender, m.recipients, m.text)
    expect(plain).toBe(m.plain)
    expect(keccak256Hex(plain)).toBe(m.messageHash)
    expect(sendMessageArgument(m.parts, m.messageHash)).toBe(m.argument)
  })

  it('are read from the call argument', () => {
    const m = website.message
    const raw = (argument) => ({
      hash: '0x1',
      height: 7,
      timestamp: 140,
      index: 2,
      from: a.toUpperCase().replace('0X', '0x'),
      args: [hex(argument)],
    })
    const parsed = parseMessageCall(raw(m.argument))
    expect(parsed.parts).toEqual(['BAAA+/=', 'BBBB/+=='])
    expect(parsed.messageHash).toBe(m.messageHash)
    expect(parsed.from).toBe(a)
    expect(parsed.time).toBe(140)
    // Not encrypted, one part, no hash.
    expect(
      parseMessageCall(
        raw(
          `{"message":["x","y"],"messageHash":"${m.messageHash}","encrypted":false}`
        )
      )
    ).toBeNull()
    expect(
      parseMessageCall(
        raw(
          `{"message":["x"],"messageHash":"${m.messageHash}","encrypted":true}`
        )
      )
    ).toBeNull()
    expect(
      parseMessageCall(raw('{"message":["x","y"],"encrypted":true}'))
    ).toBeNull()
  })

  it("keep the website's rules on reading", () => {
    const plain = plainMessage(a, [b], 'hi')
    const message = acceptMessage(call(a, 2, plain), plain, [1], b)
    expect(message.text).toBe('hi')
    expect(message.participants).toEqual([a, b])
    // The sender's own copy.
    expect(acceptMessage(call(a, 2, plain), plain, [0], a)).not.toBeNull()

    // Hash does not match; parts and participants differ; the sender is not first; not my part; not in it.
    expect(acceptMessage(call(a, 2, `${plain} `), plain, [1], b)).toBeNull()
    expect(acceptMessage(call(a, 3, plain), plain, [1], b)).toBeNull()
    expect(acceptMessage(call(c, 2, plain), plain, [1], b)).toBeNull()
    expect(acceptMessage(call(a, 2, plain), plain, [0], b)).toBeNull()
    expect(acceptMessage(call(a, 2, plain), plain, [1], c)).toBeNull()
    // A group with a duplicate; an address not lowercase.
    const twice = plainMessage(a, [b, b], 'x')
    expect(acceptMessage(call(a, 3, twice), twice, [1, 2], b)).toBeNull()
    const upper = plainMessage(a, [b], 'x').replace(
      b,
      b.toUpperCase().replace('0X', '0x')
    )
    expect(acceptMessage(call(a, 2, upper), upper, [1], b)).toBeNull()
    // A message to oneself opens both parts.
    const toSelf = plainMessage(a, [a], 'note')
    expect(acceptMessage(call(a, 2, toSelf), toSelf, [0, 1], a)).not.toBeNull()
  })

  it('show the text of a website message with more fields', () => {
    const plain = JSON.stringify([
      [a, b, c],
      '',
      'ipfs://bafkreiabc',
      'a2V5',
      '12',
      ['AAAA'],
      ['image/png'],
      '',
      [],
    ])
    const message = acceptMessage(call(a, 3, plain), plain, [2], c)
    expect(message.text).toBe('ipfs://bafkreiabc')
    expect(message.textPassword).toBe('a2V5')
    expect(message.hasMedia).toBe(true)
    expect(message.isReply).toBe(true)
  })

  it('open a text on IPFS with its key', async () => {
    const v = website.ipfsText
    const blob = Uint8Array.from(Buffer.from(v.blob, 'base64'))
    expect(await decryptIpfsText(blob, v.key)).toBe(v.text)
    const other = Buffer.alloc(32).toString('base64')
    expect(await decryptIpfsText(blob, other)).toBeNull()
  })
})

const msg = (from, participants, height, text = 'x') => ({
  hash: `0x${height}`,
  height,
  time: height * 20,
  index: 0,
  from,
  participants,
  text,
  textPassword: '',
  hasMedia: false,
  isReply: false,
})

describe('conversations', () => {
  it('are listed with their requests', () => {
    const messages = [
      msg(b, [b, a], 10),
      msg(a, [a, b], 12),
      msg(c, [c, a], 11),
      msg(b, [b, a, c], 13),
    ]
    const list = conversations(messages, a, {})
    // The latest first.
    expect(list.map(({others}) => others)).toEqual([[b, c], [b], [c]])
    // A group I never wrote in; I answered; a stranger.
    expect(list[0].isRequest).toBe(true)
    expect(list[0].isGroup).toBe(true)
    expect(list[1].isRequest).toBe(false)
    expect(list[2].isRequest).toBe(true)
    expect(list[1].messages.map(({height}) => height)).toEqual([10, 12])

    const followed = conversations(messages, a, {
      [c]: person(c, {following: true}),
    })
    expect(followed.find(({key}) => key === `${a}-${c}`).isRequest).toBe(false)
    const accepted = conversations(messages, a, {
      [c]: person(c, {message: true}),
    })
    expect(accepted.find(({key}) => key === `${a}-${c}`).isRequest).toBe(false)

    expect(unreadCount(list[1], a, null)).toBe(1)
    expect(unreadCount(list[1], a, [10, 0])).toBe(0)
  })
})

describe('the messages of the scan', () => {
  it('are each tried once, and only mine are kept', async () => {
    const plain = plainMessage(a, [b], 'hi')
    const mine = {...call(a, 2, plain, 10), hash: '0x1'}
    const other = {...call(a, 2, plain, 11), hash: '0x2'}
    let asked = 0
    const decrypt = async (chunk) => {
      asked += chunk.length
      return chunk.map((one) =>
        one === mine ? {indexes: [1], message: plain} : null
      )
    }
    const store = await readNewMessages(
      emptyChatStore(),
      [mine, other],
      b,
      decrypt
    )
    expect(store.messages.map(({text}) => text)).toEqual(['hi'])
    expect(store.tried).toEqual(['0x1', '0x2'])
    expect(await readNewMessages(store, [mine, other], b, decrypt)).toBe(store)
    // Not asked again.
    expect(asked).toBe(2)
  })
})

describe('public keys', () => {
  const key = `04${'ab'.repeat(64)}`

  it('are read as the node writes them', () => {
    expect(publicKeyHex(`0x${key.toUpperCase()}`)).toBe(key)
    expect(publicKeyHex('0x1234')).toBeNull()
    expect(publicKeyHex('')).toBeNull()
  })

  it('come from the identity, the scan, then the blocks of its calls', async () => {
    const asked = []
    const keysAt = async (height) => {
      asked.push(height)
      return height === 5 ? {[b]: key} : {}
    }
    expect(
      await findPublicKey(b, {identityKey: async () => `0x${key}`, keysAt})
    ).toBe(key)
    expect(
      await findPublicKey(b, {
        identityKey: async () => '',
        scannedKeys: {[b]: key},
        keysAt,
      })
    ).toBe(key)
    expect(
      await findPublicKey(b, {
        identityKey: async () => '',
        callHeights: [9, 7, 5, 3],
        keysAt,
      })
    ).toBe(key)
    expect(asked).toEqual([9, 7, 5])
    // Only the newest blocks are asked.
    expect(
      await findPublicKey(b, {
        identityKey: async () => '',
        callHeights: [9, 8, 7, 5],
        keysAt,
      })
    ).toBeNull()
  })
})
