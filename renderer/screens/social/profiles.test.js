/* global BigInt */
import {
  MAINNET_PROFILE_CONTRACT,
  ProfileCall,
  parseRecipient,
  profileContract,
  recipientAddress,
  callbackGas,
  keepStateGas,
  withCallbackGas,
  countTrust,
  holderOf,
  inStanding,
  readEntries,
  readProfiles,
  readTrust,
  readTrustsGiven,
  shownNames,
} from './profiles'
import {callParams, estimateCall, receiptErrors, reservedGas} from './posting'

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

  it('takes a member who got an identity out of good standing until it validates', () => {
    // The contract ends the vouch of a member with an identity: a Suspended or Zombie one is not shown as vouched for.
    expect(inStanding('Suspended', 'Human')).toBe(false)
    expect(inStanding('Zombie', 'Verified')).toBe(false)
    expect(inStanding('Killed', 'Human')).toBe(true)
    expect(inStanding('Verified', 'Suspended')).toBe(true)
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

describe('Trust counted by the giver now', () => {
  it('counts a member who validated since with the identities', () => {
    // bob gave his Trust as alice's member; he is Human now and the contract ended the vouch.
    const givers = [{address: bob, vouched: true}]
    const counts = countTrust(givers, {[bob]: 'Human'}, {})
    expect(counts).toMatchObject({identities: 1, vouched: 0})
    expect(counts.counted).toEqual([{address: bob, vouched: false}])
  })

  it('counts an identity that lost it while it is vouched for, and not after', () => {
    const givers = [{address: carol, vouched: false}]
    expect(
      countTrust(
        givers,
        {[carol]: 'Killed', [alice]: 'Verified'},
        {[carol]: alice}
      )
    ).toMatchObject({
      identities: 0,
      vouched: 1,
    })
    expect(countTrust(givers, {[carol]: 'Killed'}, {})).toMatchObject({
      identities: 0,
      vouched: 0,
    })
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

describe('gas reserved by promises', () => {
  // A claim's dry run on the social devnet (2026-10-16): 0.01 iDNA per gas, the callback with the default 10M.
  const claimReceipt = {
    success: true,
    gasUsed: 11066,
    gasCost: '110.66',
    txFee: '14.2',
    actionResult: {
      success: true,
      inputAction: {
        actionType: 1,
        method: 'claimName',
        gasLimit: 1e19,
      },
      gasUsed: 1106682,
      subActionResults: [
        {
          success: true,
          inputAction: {actionType: 5, method: '', gasLimit: 20000},
          gasUsed: 1000,
        },
        {
          success: true,
          inputAction: {
            actionType: 1,
            method: '_claimName',
            gasLimit: 10000000,
          },
          gasUsed: 689712,
        },
      ],
    },
  }

  it('makes the max fee cover the gas the promises reserve', async () => {
    expect(reservedGas(claimReceipt)).toBe(BigInt(100200))
    const {fee, maxFee} = await estimateCall(
      async () => claimReceipt,
      alice,
      ProfileCall.claimName('alice')
    )
    const wei = (idna) => BigInt(Math.round(idna * 1e6)) * BigInt(1e12)
    expect(fee).toBe(wei(124.86))
    // The node's gas limit = (max fee - size fee) / fee per gas: it must hold the call's gas and the reservations.
    const limit = (maxFee - wei(14.2)) / wei(0.01)
    expect(limit >= BigInt(11066 + 100200)).toBe(true)
    // A call without promises keeps twice its fee.
    const post = {
      success: true,
      gasUsed: 100,
      gasCost: '1',
      txFee: '1',
      actionResult: {success: true},
    }
    const plain = await estimateCall(
      async () => post,
      alice,
      ProfileCall.claimName('alice')
    )
    expect(plain.maxFee).toBe(wei(4))
  })

  it('asks the callback three times what it used, within bounds', () => {
    expect(callbackGas(claimReceipt)).toBe(2069136)
    const small = JSON.parse(JSON.stringify(claimReceipt))
    small.actionResult.subActionResults[1].gasUsed = 1000
    expect(callbackGas(small)).toBe(1000000)
    const keepOnly = {
      actionResult: {
        subActionResults: [
          {inputAction: {actionType: 1, method: '_keepState'}, gasUsed: 5},
        ],
      },
    }
    expect(callbackGas(keepOnly)).toBe(null)
    expect(
      JSON.parse(
        withCallbackGas(ProfileCall.claimName('alice'), 2069136).argument
      )
    ).toEqual({name: 'alice', _gas: 2069136})
    expect(withCallbackGas(ProfileCall.dropName(), 2069136).argument).toBe(null)
  })
})

describe('send to @name', () => {
  it('reads a To field as an address, a name or nothing valid', () => {
    expect(parseRecipient('  ')).toEqual({kind: 'empty'})
    expect(parseRecipient(alice.toUpperCase().replace('0X', '0x'))).toEqual({
      kind: 'address',
      address: alice,
    })
    expect(parseRecipient('@Felix_Desk')).toEqual({
      kind: 'name',
      name: 'felix_desk',
    })
    // A name without its @ is not taken for one: an address-like typo stays invalid.
    expect(parseRecipient('felix_desk')).toEqual({kind: 'invalid'})
    expect(parseRecipient('@ab')).toEqual({kind: 'invalid'})
    expect(parseRecipient('0x123')).toEqual({kind: 'invalid'})
  })

  it("sends to a name's holder only while it is in good standing", () => {
    const name = parseRecipient('@alice')
    expect(
      recipientAddress(name, {holder: alice, profile: {inStanding: true}})
    ).toBe(alice)
    expect(
      recipientAddress(name, {holder: alice, profile: {inStanding: false}})
    ).toBe(null)
    expect(recipientAddress(name, {holder: null, profile: null})).toBe(null)
    expect(recipientAddress(name, null)).toBe(null)
    expect(recipientAddress(parseRecipient(bob), null)).toBe(bob)
  })
})

describe('gas kept for a state read before the acting callback', () => {
  // A member's first call of an epoch: its state, then its voucher's; the first answer only keeps the state.
  const memberReceipt = {
    actionResult: {
      subActionResults: [
        {inputAction: {actionType: 5, gasLimit: 20000}, gasUsed: 1000},
        {
          inputAction: {
            actionType: 1,
            method: '_keepState',
            gasLimit: 10000000,
          },
          gasUsed: 400000,
        },
        {inputAction: {actionType: 5, gasLimit: 20000}, gasUsed: 1000},
        {
          inputAction: {actionType: 1, method: '_trust', gasLimit: 10000000},
          gasUsed: 600000,
        },
      ],
    },
  }

  it('asks three times what _keepState used, within bounds; none without it', () => {
    expect(keepStateGas(memberReceipt)).toBe(1200000)
    expect(callbackGas(memberReceipt)).toBe(1800000)
    expect(keepStateGas({actionResult: {subActionResults: []}})).toBe(null)
  })

  it('sends both gases in the argument, each only when sized', () => {
    const call = withCallbackGas(ProfileCall.trust(alice), 1800000, 1200000)
    expect(JSON.parse(call.argument)).toEqual({
      target: alice,
      _gas: 1800000,
      _keepGas: 1200000,
    })
    expect(
      JSON.parse(
        withCallbackGas(ProfileCall.trust(alice), null, 1200000).argument
      )
    ).toEqual({
      target: alice,
      _keepGas: 1200000,
    })
    expect(withCallbackGas(ProfileCall.dropName(), 1, 1).argument).toBe(null)
  })
})

describe('the profiles contract', () => {
  it("is mainnet's unless a test network's copy is given", () => {
    expect(MAINNET_PROFILE_CONTRACT).toBe(
      '0xd558483330925f169bbe692d8ea15b2faa83c17f'
    )
    expect(profileContract(undefined)).toBe(MAINNET_PROFILE_CONTRACT)
    expect(profileContract('')).toBe(MAINNET_PROFILE_CONTRACT)
    expect(profileContract('not an address')).toBe(MAINNET_PROFILE_CONTRACT)
    const devnet = '0x3055551f69558bcc8655f4d7b02dcb61747d2df0'
    expect(profileContract(devnet)).toBe(devnet)
  })
})

describe('the Trusts given', () => {
  it("are read from all Trusts, people and topics, the giver's only", async () => {
    const node = fakeNode({
      maps: {
        [`t:${alice}:${bob}`]: '10',
        [`t:r/idena_topic:${bob}`]: '11:v',
        [`t:${carol}:${alice}`]: '12',
        [`t:${dave}:${bob}`]: '13',
      },
    })
    expect(await readTrustsGiven(node.call, bob, contract)).toEqual([
      {target: alice, epoch: 10},
      {target: dave, epoch: 13},
      {target: 'r/idena_topic', epoch: 11},
    ])
    expect(await readTrustsGiven(node.call, carol, contract)).toEqual([])
  })
})
