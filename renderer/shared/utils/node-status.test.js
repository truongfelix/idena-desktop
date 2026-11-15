import {NO_PEERS_MS, NodeStatus, nodeStatus, peerCounts} from './node-status'

describe('nodeStatus', () => {
  const base = {
    syncing: false,
    compacting: false,
    converting: false,
    isBehind: false,
    peers: [{id: 'a', inbound: false}],
  }

  it('says compacting before anything else', () => {
    expect(
      nodeStatus({...base, compacting: true, syncing: true, peers: null})
    ).toBe(NodeStatus.Compacting)
    expect(nodeStatus({...base, compacting: true, peers: []})).toBe(
      NodeStatus.Compacting
    )
  })

  it('says no peers over synchronizing, behind and synchronized', () => {
    for (const state of [
      {syncing: true},
      {isBehind: true},
      {},
      {syncing: true, converting: true},
    ])
      expect(
        nodeStatus({...base, ...state, peers: [], emptyForMs: NO_PEERS_MS})
      ).toBe(NodeStatus.NoPeers)
  })

  it('waits before calling an empty list no peers', () => {
    // A node starting, or between two peers, dials for some seconds.
    expect(nodeStatus({...base, peers: []})).toBe(NodeStatus.Synchronized)
    expect(nodeStatus({...base, peers: [], emptyForMs: NO_PEERS_MS - 1})).toBe(
      NodeStatus.Synchronized
    )
    expect(
      nodeStatus({...base, syncing: true, peers: [], emptyForMs: 5000})
    ).toBe(NodeStatus.Synchronizing)
  })

  it('reads unknown peers as no claim', () => {
    expect(nodeStatus({...base, peers: null})).toBe(NodeStatus.Synchronized)
    expect(nodeStatus({...base, syncing: true, peers: undefined})).toBe(
      NodeStatus.Synchronizing
    )
  })

  it('keeps the old steps with peers', () => {
    expect(nodeStatus({...base, syncing: true})).toBe(NodeStatus.Synchronizing)
    expect(nodeStatus({...base, syncing: true, converting: true})).toBe(
      NodeStatus.Converting
    )
    expect(nodeStatus({...base, isBehind: true})).toBe(NodeStatus.Behind)
    expect(nodeStatus(base)).toBe(NodeStatus.Synchronized)
  })
})

describe('peerCounts', () => {
  it('counts in, out and direct, a direct peer once', () => {
    expect(
      peerCounts([
        {id: 'a', inbound: true},
        {id: 'b', inbound: false},
        {id: 'c', inbound: false},
        {id: 'd', inbound: true, direct: true},
      ])
    ).toEqual({
      known: true,
      total: 4,
      inbound: 1,
      outbound: 2,
      direct: 1,
      directions: true,
    })
  })

  it('has no directions from a node without the field', () => {
    const counts = peerCounts([{id: 'a'}, {id: 'b', direct: true}])
    expect(counts.directions).toBe(false)
    expect(counts.total).toBe(2)
    expect(counts.direct).toBe(1)
  })

  it('is unknown without a list', () => {
    expect(peerCounts(null)).toEqual({
      known: false,
      total: 0,
      inbound: 0,
      outbound: 0,
      direct: 0,
      directions: false,
    })
    expect(peerCounts([]).known).toBe(true)
    expect(peerCounts([]).directions).toBe(true)
  })
})
