import {inviteeAddresses, inviterOf, readIdentities} from './profile-lists'
import {a, b, c} from './test-helpers'

// The rules of the phone app's profile lists (B-79): the same invitees and inviter from the same node answer.

describe('the invitees of a profile', () => {
  it("come from the node's answer, in its order, each once, invalid ones left out", () => {
    const identity = {
      invitees: [
        {TxHash: '0x01', Address: b.toUpperCase().replace('0X', '0x')},
        {TxHash: '0x02', Address: 'not an address'},
        {TxHash: '0x03', Address: a},
        {TxHash: '0x04', Address: b},
        null,
      ],
    }
    expect(inviteeAddresses(identity)).toEqual([b, a])
  })

  it('are none without invitees', () => {
    expect(inviteeAddresses({invitees: null})).toEqual([])
    expect(inviteeAddresses(undefined)).toEqual([])
  })

  it('name the inviter while the link lasts', () => {
    expect(
      inviterOf({inviter: {txHash: '0x01', address: c, epochHeight: 9}})
    ).toBe(c)
    expect(inviterOf({inviter: null})).toBeNull()
    expect(inviterOf({})).toBeNull()
  })
})

describe("the rows' identities", () => {
  it('are read in one batch, by address', async () => {
    const asked = []
    const settled = async (method, paramsList) => {
      asked.push([method, paramsList])
      return [
        {result: {state: 'Newbie', age: 2}},
        {result: {state: 'Undefined', age: 0}},
      ]
    }
    expect(await readIdentities(settled, [a, b])).toEqual({
      [a]: {state: 'Newbie', age: 2},
      [b]: {state: 'Undefined', age: 0},
    })
    expect(asked).toEqual([['dna_identity', [[a], [b]]]])
  })

  it('fail whole when one answer failed', async () => {
    const settled = async () => [
      {result: {state: 'Human', age: 5}},
      {error: new Error('timeout')},
    ]
    await expect(readIdentities(settled, [a, b])).rejects.toThrow('timeout')
  })
})
