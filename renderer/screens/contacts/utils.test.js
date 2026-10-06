import {IdentityStatus} from '../../shared/types'
import {contactListView, loadInvites, savedContacts} from './utils'

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
        mining: undefined,
        terminating: undefined,
      },
    ])
  })

  it('returns no contacts and asks nothing when none is saved', async () => {
    const n = node()
    await expect(loadInvites([], [], n)).resolves.toEqual([])
    expect(n.calls).toEqual([])
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
