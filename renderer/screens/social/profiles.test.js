import {
  ProfileCall,
  countTrust,
  holderOf,
  inStanding,
  readEntries,
  readProfiles,
  readTrust,
  shownNames,
} from './profiles'
import {callParams, estimateCall, receiptErrors} from './posting'

const contract = '0xcccc000000000000000000000000000000000001'
const alice = '0xaaaa000000000000000000000000000000000001'
const bob = '0xbbbb000000000000000000000000000000000002'
const carol = '0xcccc000000000000000000000000000000000003'
const dave = '0xdddd000000000000000000000000000000000004'

const text = (hex) =>
  Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('utf8')

/**
 * A node holding the contract's string maps (`maps`: "a:<address>" -> value) and identity states; answers JSON-RPC
 * batches as socialRpcSettled does, and single calls. Records each method asked.
 */
function fakeNode({maps = {}, states = {}, pageSize = 100} = {}) {
  const asked = []
  const answer = (method, params) => {
    asked.push(method)
    if (method === 'contract_readMap') {
      const key = `${params[1]}${text(params[2])}`
      if (!(key in maps)) return {error: new Error('data is nil')}
      return {result: maps[key]}
    }
    if (method === 'dna_identity')
      return {
        result: {address: params[0], state: states[params[0]] || 'Undefined'},
      }
    return {error: new Error(`unexpected ${method}`)}
  }
  const settled = async (method, list) =>
    list.map((params) => answer(method, params))
  const call = async (method, params) => {
    asked.push(method)
    if (method !== 'contract_iterateMap')
      throw new Error(`unexpected ${method}`)
    const [, prefix, token] = params
    const keys = Object.keys(maps)
      .filter((k) => k.startsWith(prefix))
      .sort()
    const start = token ? Number(token) : 0
    const page = keys.slice(start, start + pageSize)
    return {
      items: page.map((k) => ({key: k.slice(prefix.length), value: maps[k]})),
      continuationToken:
        start + pageSize < keys.length ? String(start + pageSize) : null,
    }
  }
  return {settled, call, asked}
}

describe('readEntries', () => {
  it('reads a key never written as null', async () => {
    const node = fakeNode({maps: {[`a:${alice}`]: 'alice'}})
    expect(
      await readEntries(
        node.settled,
        [
          ['a:', alice],
          ['a:', bob],
        ],
        contract
      )
    ).toEqual(['alice', null])
  })

  it('throws on any other error, never "nothing"', async () => {
    const settled = async () => [{error: new Error('no answer within 70 s')}]
    await expect(
      readEntries(settled, [['a:', alice]], contract)
    ).rejects.toThrow('70 s')
  })
})

describe('profiles and names', () => {
  it('shows a name only while its holder is in good standing', async () => {
    const node = fakeNode({
      maps: {
        [`a:${alice}`]: 'alice',
        [`b:${alice}`]: 'Hello',
        [`k:${alice}`]: '3',
        [`w:${alice}`]: '1',
        [`a:${bob}`]: 'bob',
        [`a:${carol}`]: 'carol',
        [`v:${carol}`]: dave,
      },
      states: {
        [alice]: 'Human',
        [bob]: 'Zombie',
        [carol]: 'Undefined',
        [dave]: 'Verified',
      },
    })
    const profiles = await readProfiles(node.settled, [
      alice,
      bob,
      carol.toUpperCase().replace('0X', '0x'),
    ])
    expect(profiles[alice]).toMatchObject({
      name: 'alice',
      bio: 'Hello',
      trusted: 3,
      trustedVouched: 1,
      inStanding: true,
    })
    // A Zombie keeps its name stored but it is not shown; a member vouched for by a Verified is shown.
    expect(profiles[bob].inStanding).toBe(false)
    expect(profiles[carol]).toMatchObject({
      voucher: dave,
      voucherState: 'Verified',
      inStanding: true,
    })
    expect(shownNames(profiles)).toEqual({[alice]: '@alice', [carol]: '@carol'})
  })

  it('takes a voucher out of good standing with its member', () => {
    expect(inStanding('Undefined', 'Verified')).toBe(true)
    expect(inStanding('Undefined', 'Suspended')).toBe(false)
    expect(inStanding('Candidate', null)).toBe(false)
    expect(inStanding('Newbie')).toBe(true)
  })

  it('finds the holder of a name, with or without its @', async () => {
    const node = fakeNode({
      maps: {'n:alice': alice.toUpperCase().replace('0X', '0x')},
    })
    expect(await holderOf(node.settled, '@Alice')).toBe(alice)
    expect(await holderOf(node.settled, 'nobody')).toBe(null)
    // Not a name: nothing asked.
    const before = node.asked.length
    expect(await holderOf(node.settled, 'a!')).toBe(null)
    expect(node.asked.length).toBe(before)
  })
})

describe('Trust', () => {
  it('counts trusting identities and vouched members in good standing only', async () => {
    const maps = {
      [`t:${dave}:${alice}`]: '5',
      [`t:${dave}:${bob}`]: '6',
      [`t:${dave}:${carol}`]: '7:v',
      [`v:${carol}`]: alice,
    }
    // Over several pages.
    const node = fakeNode({
      maps,
      states: {[alice]: 'Human', [bob]: 'Killed', [carol]: 'Undefined'},
      pageSize: 1,
    })
    const trust = await readTrust(node.call, node.settled, dave)
    expect(trust.givers.map((g) => g.address)).toEqual([alice, bob, carol])
    expect(trust.identities).toBe(1)
    expect(trust.vouched).toBe(1)
    expect(trust.counted.map((g) => g.address)).toEqual([alice, carol])
  })

  it('counts a Zombie or Suspended giver, not a vouched member whose voucher lost its status', () => {
    const givers = [
      {address: alice, vouched: false},
      {address: bob, vouched: false},
      {address: carol, vouched: true},
    ]
    const counts = countTrust(
      givers,
      {
        [alice]: 'Zombie',
        [bob]: 'Suspended',
        [carol]: 'Undefined',
        [dave]: 'Zombie',
      },
      {[carol]: dave}
    )
    expect(counts).toMatchObject({identities: 2, vouched: 0})
  })
})

describe('profile calls', () => {
  it('names the profiles contract and sends no argument to dropName', () => {
    const [params] = callParams(alice, {...ProfileCall.dropName(), contract})
    expect(params).toMatchObject({
      contract,
      method: 'dropName',
      args: [],
      amount: '0',
    })
    const [claim] = callParams(alice, {
      ...ProfileCall.claimName('alice'),
      contract,
    })
    expect(claim.args).toEqual([
      {index: 0, format: 'string', value: '{"name":"alice"}'},
    ])
  })

  it('takes a callback refused in the dry run for a refusal', async () => {
    const receipt = {
      success: true,
      txFee: '1',
      gasCost: '2',
      actionResult: {
        success: true,
        subActionResults: [
          {success: false, error: 'neither validated nor vouched for'},
        ],
      },
    }
    expect(receiptErrors(receipt)).toEqual([
      'neither validated nor vouched for',
    ])
    const call = async () => receipt
    await expect(
      estimateCall(call, alice, ProfileCall.claimName('alice'))
    ).rejects.toThrow('neither validated nor vouched for')
  })
})
