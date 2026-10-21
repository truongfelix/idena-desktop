import {secp256k1} from '@noble/curves/secp256k1.js'
import {OWN_KEY_TEXT, ownPublicKey, publicKeyOfSignature} from './own-key'
import {addressOfPublicKey} from './message-code'
import {keccak256} from './keccak'

// A signature of OWN_KEY_TEXT by a test node (dna_sign, idena-go 1.1.2 of the built-in node), and that node's address.
const NODE_SIGNATURE =
  '0xc8e435035382088e6a652492ba326547c92c165fe5e5e9955bf54191ed0f26e054190266189e0d39a800e3b10717a9f32385b4d978712cede4f2f5b5b4f7663601'
const NODE_ADDRESS = '0xae752fb1ead1fe09085854c981c11fbf33f99af3'

const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// A signature as the node gives it (r, s, then the recovery byte), made with `secretKey`.
function nodeSignature(text, secretKey) {
  const hash = keccak256(keccak256(new TextEncoder().encode(text)))
  const recovered = secp256k1.sign(hash, secretKey, {
    format: 'recovered',
    prehash: false,
  })
  return `0x${hex(recovered.slice(1))}${hex(recovered.slice(0, 1))}`
}

describe('the own public key from a signature', () => {
  it('gives back the address of the node that signed', async () => {
    expect(OWN_KEY_TEXT).toBe("Idena desktop: this account's message code")
    const key = publicKeyOfSignature(OWN_KEY_TEXT, NODE_SIGNATURE)
    expect(key).toMatch(/^04[0-9a-f]{128}$/)
    expect(addressOfPublicKey(key)).toBe(NODE_ADDRESS)

    const call = jest.fn(async () => NODE_SIGNATURE)
    expect(
      await ownPublicKey('0xAE752fB1eAd1fE09085854c981C11fbf33f99AF3', call)
    ).toBe(key)
    expect(call).toHaveBeenCalledWith('dna_sign', [OWN_KEY_TEXT])
  })

  it('recovers each key, whichever recovery byte its signature has', () => {
    const bytes = new Set()
    for (let i = 0; i < 40; i += 1) {
      const {secretKey, publicKey} = secp256k1.keygen()
      const signature = nodeSignature(OWN_KEY_TEXT, secretKey)
      bytes.add(signature.slice(-2))
      expect(publicKeyOfSignature(OWN_KEY_TEXT, signature)).toBe(
        hex(secp256k1.Point.fromBytes(publicKey).toBytes(false))
      )
    }
    expect([...bytes].sort()).toEqual(['00', '01'])
  })

  it("keeps no key that is not the account's", async () => {
    expect(
      await ownPublicKey(`0x${'11'.repeat(20)}`, async () => NODE_SIGNATURE)
    ).toBeNull()
    // Another text, a changed byte, a wrong recovery byte: another key or none.
    const changed =
      NODE_SIGNATURE.slice(0, 10) +
      (NODE_SIGNATURE[10] === 'a' ? 'b' : 'a') +
      NODE_SIGNATURE.slice(11)
    const flipped =
      NODE_SIGNATURE.slice(0, -2) +
      (NODE_SIGNATURE.endsWith('01') ? '00' : '01')
    for (const [text, signature] of [
      ['another text', NODE_SIGNATURE],
      [OWN_KEY_TEXT, changed],
      [OWN_KEY_TEXT, flipped],
    ]) {
      const key = publicKeyOfSignature(text, signature)
      expect(key && addressOfPublicKey(key)).not.toBe(NODE_ADDRESS)
    }
  })

  it('gives no key for what is no signature', () => {
    for (const signature of [
      null,
      '',
      '0x',
      '0x1234',
      `${NODE_SIGNATURE}00`,
      NODE_SIGNATURE.replace(/.$/, 'g'),
      `${NODE_SIGNATURE.slice(0, -2)}05`,
    ])
      expect(publicKeyOfSignature(OWN_KEY_TEXT, signature)).toBeNull()
  })
})
