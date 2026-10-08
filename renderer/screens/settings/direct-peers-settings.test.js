import {directPeerState, pendingNodeOptions} from './advanced-settings'

const rsaId = 'QmNqkSwad5HTShxVzFcYLQkRCRjrs9ZhQykqrRTQcdR7xp'
const ed25519Id = '12D3KooWKgas1i8Ua9oBEC8wiKfhfdo47idCUXnmratPUpLjthm8'
const thirdId = 'QmTseSBwV9xPN2iEn6ViZbdPbk5MBk1HAD9SKy8B2EgSrY'

const settings = {
  dbWriteBufferMiB: 4,
  ipfsWriteBufferMiB: 4,
  peerLevel: 'normal',
  ipfsConnections: 50,
}
const running = {...settings, directPeers: []}
const supported = {
  dbWriteBuffer: true,
  ipfsWriteBuffer: true,
  peerLimits: true,
  directPeers: true,
}
const pending = (chosen, runningPeers, isSupported = true) =>
  pendingNodeOptions({
    nodeStarted: true,
    running: {...running, directPeers: runningPeers},
    supported: {...supported, directPeers: isSupported},
    settings: {...settings, directPeers: chosen},
  })

describe('direct peers in Advanced settings', () => {
  it('asks for a restart for a new list, not for a rename', () => {
    expect(pending([{id: rsaId, name: 'Anna'}], [])).toEqual([
      {title: 'Direct peers', value: 'Anna'},
    ])
    expect(pending([{id: rsaId, name: 'renamed'}], [rsaId])).toEqual([])
    // The same ids in another order.
    expect(
      pending(
        [
          {id: thirdId, name: 'C'},
          {id: rsaId, name: 'A'},
        ],
        [rsaId, thirdId].sort()
      )
    ).toEqual([])
    expect(pending([], [rsaId])).toEqual([
      {title: 'Direct peers', value: 'none'},
    ])
  })

  it('names an unnamed peer by its short id', () => {
    expect(pending([{id: rsaId, name: ''}], [])).toEqual([
      {title: 'Direct peers', value: 'QmNqkS…cdR7xp'},
    ])
  })

  it('never asks with a node binary without the flag, or before the node reported', () => {
    expect(pending([{id: rsaId, name: 'A'}], [], false)).toEqual([])
    expect(pending([{id: rsaId, name: 'A'}], undefined)).toEqual([])
  })

  it("shows each peer's state from the node's peers", () => {
    const peerIds = new Set([rsaId, 'QmOther'])
    const runningIds = {directPeers: [rsaId, ed25519Id]}
    expect(directPeerState(rsaId, {peerIds, running: runningIds})).toBe(
      'connected'
    )
    expect(directPeerState(ed25519Id, {peerIds, running: runningIds})).toBe(
      'not connected'
    )
    expect(directPeerState(thirdId, {peerIds, running: runningIds})).toBe(
      'after a restart'
    )
    expect(directPeerState(rsaId, {peerIds: null, running: runningIds})).toBe(
      'node stopped'
    )
  })
})
