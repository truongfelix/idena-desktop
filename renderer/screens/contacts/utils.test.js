import {IdentityStatus} from '../../shared/types'
import {HASH_IN_MEMPOOL} from '../../shared/utils/utils'
import {
  checkActivation,
  checkMining,
  checkTerminations,
  contactListView,
  isTerminatedInvite,
  loadInvites,
  savedContacts,
} from './utils'

const alice = {
  id: 'a',
  firstName: 'Alice',
  lastName: 'Saved',
  hash: '0xa1',
  receiver: '0x11',
  canKill: true,
  terminateHash: '0xb2',
}
const bob = {
  id: 'b',
  firstName: 'Bob',
  lastName: 'Deleted',
  hash: '0xc3',
  receiver: '0x22',
  deletedAt: 1,
}
const carol = {
  id: 'c',
  firstName: 'Carol',
  lastName: '',
  hash: '0xd4',
  receiver: '0x33',
}

function node({failRpc = () => false, failIdentity = () => false} = {}) {
  const calls = []
  return {
    calls,
    callRpc: jest.fn(async (method, hash) => {
      calls.push(`${method} ${hash}`)
      if (failRpc(hash)) throw new Error('Failed to fetch')
      return null
    }),
    fetchIdentity: jest.fn(async (address) => {
      calls.push(`dna_identity ${address}`)
      if (failIdentity(address)) throw new Error('Failed to fetch')
      return {address, state: IdentityStatus.Invite}
    }),
    saveInvite: jest.fn(),
  }
}

describe('saved contacts before the node answers', () => {
  it('keeps every saved contact and leaves terminating to the node', () => {
    expect(savedContacts([alice, bob])).toEqual([
      {...alice, dbkey: 'a', canKill: false},
      {...bob, dbkey: 'b', canKill: false},
    ])
    expect(savedContacts([])).toEqual([])
  })
})

describe('loading the contacts with the node', () => {
  it('keeps every contact when all node calls fail', async () => {
    const n = node({failRpc: () => true, failIdentity: () => true})
    const invites = await loadInvites(
      [alice, bob, carol],
      [{Address: '0x44', TxHash: '0xd4'}],
      n
    )
    expect(invites.map(({id}) => id)).toEqual(['a', 'b', 'c'])
    expect(invites[0]).toMatchObject({
      dbkey: 'a',
      identity: undefined,
      canKill: false,
    })
    expect(invites[0].mining).toBeFalsy()
    expect(invites[0].terminating).toBeFalsy()
    // the invitee the node lists still activates the invite, without its identity
    expect(invites[2]).toMatchObject({activated: true, receiver: '0x44'})
    expect(n.saveInvite).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({activated: true, receiver: '0x44'})
    )
  })

  it('leaves out only the part of a failed call', async () => {
    const n = node({failIdentity: (address) => address === '0x11'})
    const invites = await loadInvites([alice, carol], [], n)
    expect(invites[0]).toMatchObject({identity: undefined, canKill: false})
    expect(invites[1]).toMatchObject({
      identity: {address: '0x33', state: IdentityStatus.Invite},
      canKill: true,
    })
    expect(n.saveInvite).not.toHaveBeenCalled()
  })

  it('asks nothing about deleted contacts and keeps them', async () => {
    const n = node()
    const invites = await loadInvites([bob], undefined, n)
    expect(n.calls).toEqual([])
    expect(invites).toEqual([
      {
        ...bob,
        activated: false,
        canKill: false,
        dbkey: 'b',
        identity: undefined,
        mining: false,
        terminating: false,
      },
    ])
  })

  it('returns no contacts and asks nothing when none is saved', async () => {
    const n = node()
    await expect(loadInvites([], [], n)).resolves.toEqual([])
    expect(n.calls).toEqual([])
  })
})

// The node's bcn_transaction answer (callRpc returns the result): no block yet while the tx is in the mempool.
const txIn = (blockHash) => (hash) => ({hash, blockHash, type: 'invite'})
const inMempool = txIn(HASH_IN_MEMPOOL)
const inBlock = txIn('0x5e7b')
// a tx the node does not know (dropped from the mempool, or sent through another node)
const unknown = () => null

function nodeWithTxs(txs, identities = {}) {
  const calls = []
  return {
    calls,
    callRpc: jest.fn(async (method, arg) => {
      calls.push(`${method} ${arg}`)
      if (method === 'bcn_transaction') {
        if (!txs[arg]) throw new Error('transaction not found')
        return txs[arg](arg)
      }
      if (method === 'dna_identity') return identities[arg]
      throw new Error(`unexpected ${method}`)
    }),
    fetchIdentity: jest.fn(async (address) => ({
      address,
      state: IdentityStatus.Undefined,
    })),
    saveInvite: jest.fn(),
  }
}

describe('invites and terminations in the mempool', () => {
  const sent = {id: 's', hash: '0xe5', receiver: '0x55', key: 'k'}
  const terminated = {...alice, canKill: false}

  it('marks an invite whose tx is in the mempool as mining', async () => {
    const n = nodeWithTxs({'0xe5': inMempool})
    const [invite] = await loadInvites([sent], [], n)
    expect(invite).toMatchObject({mining: true, terminating: false})
  })

  it('does not mark an invite whose tx is in a block', async () => {
    const n = nodeWithTxs({'0xe5': inBlock})
    const [invite] = await loadInvites([sent], [], n)
    expect(invite.mining).toBe(false)
  })

  it('marks a contact whose termination tx is in the mempool as terminating', async () => {
    const n = nodeWithTxs({'0xa1': inBlock, '0xb2': inMempool})
    const [invite] = await loadInvites([terminated], [], n)
    expect(invite).toMatchObject({mining: false, terminating: true})
  })

  it('does not mark a contact whose termination tx is in a block', async () => {
    const n = nodeWithTxs({'0xa1': inBlock, '0xb2': inBlock})
    const [invite] = await loadInvites([terminated], [], n)
    expect(invite.terminating).toBe(false)
  })

  describe('checking the invites being mined', () => {
    const mining = {...sent, mining: true, canKill: false}
    const invited = {address: '0x55', state: IdentityStatus.Invite}

    it('ends mining once the invite tx is in a block, and offers to terminate it', async () => {
      const n = nodeWithTxs({'0xe5': inBlock}, {'0x55': invited})
      const invites = await checkMining([mining, carol], n)
      expect(invites).toEqual([
        {
          ...mining,
          mining: false,
          identity: invited,
          state: IdentityStatus.Invite,
          canKill: true,
        },
        carol,
      ])
      expect(n.calls).toEqual(['bcn_transaction 0xe5', 'dna_identity 0x55'])
    })

    it('keeps mining while the invite tx is in the mempool', async () => {
      const n = nodeWithTxs({'0xe5': inMempool})
      expect(await checkMining([mining], n)).toBeNull()
      expect(n.calls).toEqual(['bcn_transaction 0xe5'])
    })

    it('keeps mining when the identity call fails', async () => {
      const n = nodeWithTxs({'0xe5': inBlock})
      n.callRpc.mockImplementation(async (method, arg) => {
        if (method === 'dna_identity') throw new Error('Failed to fetch')
        return inBlock(arg)
      })
      expect(await checkMining([mining], n)).toBeNull()
    })

    it('ends mining once the node has not known the invite tx for 3 checks in a row', async () => {
      const notInvited = {address: '0x55', state: IdentityStatus.Undefined}
      const n = nodeWithTxs({'0xe5': unknown}, {'0x55': notInvited})

      const first = await checkMining([mining, carol], n)
      expect(first).toEqual([{...mining, unknownPolls: 1}, carol])
      const second = await checkMining(first, n)
      expect(second[0]).toEqual({...mining, unknownPolls: 2})
      const third = await checkMining(second, n)

      // as after a reload: an invite the node never mined reads as expired
      expect(third).toEqual([
        {
          ...mining,
          mining: false,
          identity: notInvited,
          state: IdentityStatus.Undefined,
          canKill: false,
        },
        carol,
      ])
      expect(n.calls).toEqual([
        'bcn_transaction 0xe5',
        'bcn_transaction 0xe5',
        'bcn_transaction 0xe5',
        'dna_identity 0x55',
      ])
    })

    it('counts again once the node knows the invite tx again', async () => {
      const n = nodeWithTxs({'0xe5': inMempool})
      const invites = await checkMining([{...mining, unknownPolls: 2}], n)
      expect(invites).toEqual([{...mining, unknownPolls: 0}])
    })

    it('does not count a failed call as an unknown tx', async () => {
      const n = nodeWithTxs({})
      expect(await checkMining([{...mining, unknownPolls: 2}], n)).toBeNull()
    })

    it('keeps the count when the identity call fails after the third unknown answer', async () => {
      const n = nodeWithTxs({'0xe5': unknown})
      n.callRpc.mockImplementation(async (method) => {
        if (method === 'dna_identity') throw new Error('Failed to fetch')
        return null
      })
      expect(await checkMining([{...mining, unknownPolls: 2}], n)).toBeNull()
    })
  })

  describe('checking the terminations', () => {
    // the node deletes a terminated identity: it answers Undefined
    const killed = {address: '0x11', state: IdentityStatus.Undefined}
    const terminating = {...terminated, terminating: true}

    it('ends a termination once its tx is in a block', async () => {
      const n = nodeWithTxs({'0xb2': inBlock}, {'0x11': killed})
      const invites = await checkTerminations([terminating, carol], n)
      expect(invites).toEqual([
        {
          ...terminating,
          identity: killed,
          state: IdentityStatus.Undefined,
          terminating: false,
          canKill: false,
        },
        carol,
      ])
      // the termination tx, not the invite tx
      expect(n.calls).toEqual(['bcn_transaction 0xb2', 'dna_identity 0x11'])
    })

    it('keeps a termination whose tx is still in the mempool', async () => {
      const n = nodeWithTxs({'0xb2': inMempool})
      expect(await checkTerminations([terminating, carol], n)).toBeNull()
      expect(n.calls).toEqual(['bcn_transaction 0xb2'])
    })

    it('keeps a termination when the node call fails', async () => {
      const n = nodeWithTxs({})
      expect(await checkTerminations([terminating], n)).toBeNull()
    })

    it('ends a termination the node has not known for 3 checks in a row, and offers it again', async () => {
      // the termination never made it into a block: the invitation still stands
      const invited = {address: '0x11', state: IdentityStatus.Invite}
      const n = nodeWithTxs({'0xb2': unknown}, {'0x11': invited})

      const first = await checkTerminations([terminating, carol], n)
      expect(first[0]).toEqual({...terminating, unknownPolls: 1})
      const second = await checkTerminations(first, n)
      expect(second[0]).toEqual({...terminating, unknownPolls: 2})
      const invites = await checkTerminations(second, n)

      expect(invites).toEqual([
        {
          ...terminating,
          identity: invited,
          state: IdentityStatus.Invite,
          terminating: false,
          canKill: true,
        },
        carol,
      ])
      expect(isTerminatedInvite(invites[0])).toBe(false)
    })

    it('ends the terminations that are done and keeps the others', async () => {
      const other = {
        ...carol,
        terminating: true,
        terminateHash: '0xf6',
      }
      const n = nodeWithTxs(
        {'0xb2': inBlock, '0xf6': inMempool},
        {'0x11': killed}
      )
      const invites = await checkTerminations([terminating, other], n)
      expect(invites[0]).toMatchObject({
        terminating: false,
        state: IdentityStatus.Undefined,
      })
      expect(invites[1]).toBe(other)
    })

    it('asks nothing when no contact is terminating', async () => {
      const n = nodeWithTxs({})
      expect(await checkTerminations([alice, carol], n)).toBeNull()
      expect(n.calls).toEqual([])
    })
  })
})

describe('checking the activation tx', () => {
  it('is mined once the tx is in a block', async () => {
    const n = nodeWithTxs({'0xa7': inBlock})
    expect(await checkActivation('0xa7', 2, n)).toEqual({status: 'mined'})
  })

  it('keeps mining while the tx is in the mempool, and counts again', async () => {
    const n = nodeWithTxs({'0xa7': inMempool})
    expect(await checkActivation('0xa7', 2, n)).toEqual({
      status: 'mining',
      unknownPolls: 0,
    })
  })

  it('is dropped once the node has not known the tx for 3 checks in a row', async () => {
    const n = nodeWithTxs({'0xa7': unknown})
    expect(await checkActivation('0xa7', 0, n)).toEqual({
      status: 'mining',
      unknownPolls: 1,
    })
    expect(await checkActivation('0xa7', 1, n)).toEqual({
      status: 'mining',
      unknownPolls: 2,
    })
    expect(await checkActivation('0xa7', 2, n)).toEqual({status: 'dropped'})
  })

  it('keeps mining and the count when the node call fails', async () => {
    const n = nodeWithTxs({})
    expect(await checkActivation('0xa7', 2, n)).toEqual({
      status: 'mining',
      unknownPolls: 2,
    })
  })
})

describe('a terminated invitation', () => {
  const sentTermination = {terminateHash: '0xb2', terminating: false}

  it('is one whose termination left the mempool and whose invitee the node deleted', () => {
    expect(
      isTerminatedInvite({...sentTermination, state: IdentityStatus.Undefined})
    ).toBe(true)
  })

  it('is not one whose termination is still in the mempool', () => {
    expect(
      isTerminatedInvite({
        ...sentTermination,
        terminating: true,
        state: IdentityStatus.Invite,
      })
    ).toBe(false)
  })

  it('is not one whose invitee the node still knows (the termination never made it into a block)', () => {
    expect(
      isTerminatedInvite({...sentTermination, state: IdentityStatus.Invite})
    ).toBe(false)
  })

  it('is not one without a termination, nor one whose identity is unknown', () => {
    expect(isTerminatedInvite({state: IdentityStatus.Undefined})).toBe(false)
    expect(isTerminatedInvite({...sentTermination, state: undefined})).toBe(
      false
    )
  })
})

describe('what the contact list shows', () => {
  const invites = [alice, bob, carol]

  it('says there are no contacts when none is saved or all are deleted', () => {
    expect(contactListView([], undefined)).toEqual({
      contacts: [],
      status: 'empty',
    })
    expect(contactListView([bob], '')).toEqual({contacts: [], status: 'empty'})
  })

  it('lists the contacts that are not deleted', () => {
    expect(contactListView(invites, undefined)).toEqual({
      contacts: [alice, carol],
      status: 'list',
    })
  })

  it('searches names and addresses in any case', () => {
    expect(contactListView(invites, 'ALI').contacts).toEqual([alice])
    expect(contactListView(invites, '0x33').contacts).toEqual([carol])
    expect(contactListView(invites, 'saved').contacts).toEqual([alice])
  })

  it('finds nothing when the search only matches deleted contacts', () => {
    expect(contactListView(invites, 'bob')).toEqual({
      contacts: [],
      status: 'notFound',
    })
    expect(contactListView(invites, 'zzz').status).toBe('notFound')
    expect(contactListView([], 'zzz').status).toBe('notFound')
  })
})
