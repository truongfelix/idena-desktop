const {
  cleanDirectPeers,
  cleanPeerName,
  directPeerArgs,
  directPeerIds,
  directPeerProblem,
  isPeerId,
  nodeSupportsDirectPeers,
  ownPeerId,
  parsePeerCode,
  peerCode,
  shortPeerId,
} = require('./direct-peers')

// Valid and invalid ids as idena-go's peer.Decode (go-libp2p v0.48) takes them, checked 2026-10-08; the phone
// app's DirectPeersTest uses the same.
const rsaId = 'QmNqkSwad5HTShxVzFcYLQkRCRjrs9ZhQykqrRTQcdR7xp'
const ed25519Id = '12D3KooWKgas1i8Ua9oBEC8wiKfhfdo47idCUXnmratPUpLjthm8'
const otherEd25519Id = '12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN'
const thirdId = 'QmTseSBwV9xPN2iEn6ViZbdPbk5MBk1HAD9SKy8B2EgSrY'

describe('direct peers', () => {
  it('takes peer ids as the node does', () => {
    expect(isPeerId(rsaId)).toBe(true)
    expect(isPeerId(ed25519Id)).toBe(true)
    expect(isPeerId(otherEd25519Id)).toBe(true)
    // peer.Decode refuses each of these.
    expect(isPeerId(rsaId.slice(0, -1))).toBe(false)
    expect(isPeerId(`${rsaId}p`)).toBe(false)
    expect(isPeerId(rsaId.replace('R7xp', 'R70p'))).toBe(false)
    expect(isPeerId('')).toBe(false)
    expect(isPeerId(undefined)).toBe(false)
    expect(isPeerId(`/ip4/1.2.3.4/tcp/40405/p2p/${rsaId}`)).toBe(false)
  })

  it('writes and reads the code with its name', () => {
    expect(peerCode(rsaId, 'Felix desktop')).toBe(
      `idena-peer:${rsaId}#Felix desktop`
    )
    expect(peerCode(rsaId, '  ')).toBe(`idena-peer:${rsaId}`)
    expect(parsePeerCode(peerCode(rsaId, 'Felix desktop'))).toEqual({
      id: rsaId,
      name: 'Felix desktop',
    })
    expect(parsePeerCode(`  ${rsaId}\n`)).toEqual({id: rsaId, name: ''})
    expect(parsePeerCode(`IDENA-PEER:${rsaId} # Anna `)).toEqual({
      id: rsaId,
      name: 'Anna',
    })
    expect(parsePeerCode(`idena-peer:${rsaId}#A#B`)).toEqual({
      id: rsaId,
      name: 'A#B',
    })
    expect(parsePeerCode('idena-peer:')).toBeNull()
    expect(parsePeerCode(`idena-peer:${rsaId.slice(0, -1)}#Anna`)).toBeNull()
    expect(parsePeerCode('hello')).toBeNull()
  })

  it('keeps names to one short line', () => {
    expect(cleanPeerName('  Anna desktop ')).toBe('Anna desktop')
    expect(cleanPeerName('Anna\ndesktop')).toBe('Anna desktop')
    expect(cleanPeerName('x'.repeat(100))).toHaveLength(40)
    expect(cleanPeerName(undefined)).toBe('')
  })

  it("refuses the node's own code, a node twice and a fourth one", () => {
    const list = [
      {id: rsaId, name: 'A'},
      {id: ed25519Id, name: 'B'},
    ]
    expect(directPeerProblem({id: thirdId}, list, thirdId)).toBe(
      "This is your own node's code."
    )
    expect(directPeerProblem({id: rsaId}, list, null)).toBe(
      'This node is already in the list.'
    )
    expect(directPeerProblem({id: thirdId}, list, null)).toBeNull()
    expect(
      directPeerProblem(
        {id: otherEd25519Id},
        [...list, {id: thirdId, name: 'C'}],
        null
      )
    ).toBe('The list holds at most 3 nodes.')
  })

  it('reads its own id from the IPFS address', () => {
    expect(ownPeerId(`/ip4/0.0.0.0/tcp/40405/ipfs/${rsaId}`)).toBe(rsaId)
    expect(ownPeerId(`/ip4/0.0.0.0/tcp/40405/p2p/${ed25519Id}`)).toBe(ed25519Id)
    expect(ownPeerId(null)).toBeNull()
    expect(ownPeerId('/ip4/0.0.0.0/tcp/40405')).toBeNull()
  })

  it('cleans a stored list of what the node would refuse', () => {
    const stored = [
      {id: rsaId, name: 'A'},
      {id: 'not-an-id', name: 'bad'},
      {id: rsaId, name: 'twice'},
      null,
      {id: ed25519Id, name: 'B\n'},
      {id: thirdId, name: 'C'},
      {id: otherEd25519Id, name: 'D'},
    ]
    expect(cleanDirectPeers(stored)).toEqual([
      {id: rsaId, name: 'A'},
      {id: ed25519Id, name: 'B'},
      {id: thirdId, name: 'C'},
    ])
    expect(cleanDirectPeers(undefined)).toEqual([])
    expect(directPeerIds(stored)).toEqual([ed25519Id, rsaId, thirdId].sort())
  })

  it('passes the ids only to a node that has the flag', () => {
    const help = '--maxinboundpeers value\n--directpeers value  Up to 3 nodes'
    const peers = [
      {id: thirdId, name: 'C'},
      {id: rsaId, name: 'A'},
    ]
    expect(nodeSupportsDirectPeers(help)).toBe(true)
    expect(directPeerArgs(peers, help)).toEqual([
      '--directpeers',
      [rsaId, thirdId].sort().join(','),
    ])
    expect(directPeerArgs([], help)).toEqual([])
    // An official binary would not start with an unknown flag.
    expect(directPeerArgs(peers, '--maxinboundpeers value')).toEqual([])
    expect(directPeerArgs(peers, '')).toEqual([])
  })

  it('shortens ids for the list', () => {
    expect(shortPeerId(rsaId)).toBe('QmNqkS…cdR7xp')
    expect(shortPeerId('Qm123')).toBe('Qm123')
  })
})
