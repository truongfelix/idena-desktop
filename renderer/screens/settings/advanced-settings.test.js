import {
  DB_WRITE_BUFFERS,
  IPFS_CONNECTION_CHOICES,
  IPFS_WRITE_BUFFERS,
  PEER_LEVEL_CHOICES,
  optionPending,
  pendingNodeOptions,
  restartRisk,
} from './advanced-settings'

const now = new Date('2026-10-04T12:00:00Z')
const inMinutes = (minutes) =>
  new Date(now.getTime() + minutes * 60 * 1000).toISOString()

describe('advanced node settings', () => {
  it('offers the four sizes for each database', () => {
    expect(DB_WRITE_BUFFERS.map(({mib}) => mib)).toEqual([4, 16, 32, 64])
    expect(IPFS_WRITE_BUFFERS.map(({mib}) => mib)).toEqual([4, 16, 32, 64])
  })

  it("offers the phone app's peer levels and IPFS limits", () => {
    expect(
      PEER_LEVEL_CHOICES.map(({label, maxPeers}) => [label, maxPeers])
    ).toEqual([
      ['Eco', 7],
      ['Normal', 18],
      ['Hub', 30],
    ])
    expect(IPFS_CONNECTION_CHOICES.map(({label}) => label)).toEqual([
      '20',
      '50',
      '100',
      'No limit',
    ])
  })

  it('is pending only while the node runs with another size', () => {
    expect(optionPending({nodeStarted: true, running: 4, chosen: 32})).toBe(
      true
    )
    expect(optionPending({nodeStarted: true, running: 32, chosen: 32})).toBe(
      false
    )
    expect(optionPending({nodeStarted: false, running: 4, chosen: 32})).toBe(
      false
    )
    expect(optionPending({nodeStarted: true, running: null, chosen: 32})).toBe(
      false
    )
  })

  it('is never pending for a node binary without the flag', () => {
    expect(
      optionPending({
        nodeStarted: true,
        running: 4,
        chosen: 32,
        supported: false,
      })
    ).toBe(false)
    expect(
      optionPending({
        nodeStarted: true,
        running: 4,
        chosen: 32,
        supported: true,
      })
    ).toBe(true)
  })

  it('blocks a restart during the validation', () => {
    for (const currentPeriod of [
      'FlipLottery',
      'ShortSession',
      'LongSession',
    ]) {
      expect(
        restartRisk(now, {currentPeriod, nextValidation: inMinutes(-1)})
          .canRestart
      ).toBe(false)
    }
  })

  it('warns within three hours before the validation', () => {
    const risk = restartRisk(now, {
      currentPeriod: 'None',
      nextValidation: inMinutes(150),
    })
    expect(risk.canRestart).toBe(true)
    expect(risk.message).toMatch('starts soon')
    expect(
      restartRisk(now, {currentPeriod: 'None', nextValidation: inMinutes(179)})
    ).not.toBeNull()
  })

  it('says nothing otherwise', () => {
    expect(
      restartRisk(now, {currentPeriod: 'None', nextValidation: inMinutes(180)})
    ).toBeNull()
    expect(
      restartRisk(now, {currentPeriod: 'None', nextValidation: inMinutes(-60)})
    ).toBeNull()
    expect(restartRisk(now, null)).toBeNull()
    expect(restartRisk(now, {currentPeriod: 'None'})).toBeNull()
  })

  const settings = {
    dbWriteBufferMiB: 32,
    ipfsWriteBufferMiB: 4,
    peerLevel: 'hub',
    ipfsConnections: 100,
  }
  const supported = {
    dbWriteBuffer: true,
    ipfsWriteBuffer: true,
    peerLimits: true,
  }

  it('lists the settings the running node does not use, in page order', () => {
    expect(
      pendingNodeOptions({
        nodeStarted: true,
        running: {
          dbWriteBufferMiB: 4,
          ipfsWriteBufferMiB: 4,
          peerLevel: 'normal',
          ipfsConnections: 100,
        },
        supported,
        settings,
      })
    ).toEqual([
      {title: 'Peer level', value: 'Hub'},
      {title: 'Chain database write buffer', value: '32 MiB'},
    ])
    expect(
      pendingNodeOptions({nodeStarted: false, running: {}, supported, settings})
    ).toEqual([])
  })

  it('compares the IPFS limit the level can run with', () => {
    // 50 is too few for Hub: the node gets 100, as it runs already.
    expect(
      pendingNodeOptions({
        nodeStarted: true,
        running: {...settings, ipfsConnections: 100},
        supported,
        settings: {...settings, ipfsConnections: 50},
      })
    ).toEqual([])
  })

  it('never lists a setting the node binary has no flag for', () => {
    expect(
      pendingNodeOptions({
        nodeStarted: true,
        running: {
          dbWriteBufferMiB: 4,
          ipfsWriteBufferMiB: 4,
          peerLevel: 'normal',
          ipfsConnections: 50,
        },
        supported: {
          dbWriteBuffer: false,
          ipfsWriteBuffer: false,
          peerLimits: false,
        },
        settings,
      })
    ).toEqual([])
    // Started before the node reported its settings.
    expect(
      pendingNodeOptions({
        nodeStarted: true,
        running: null,
        supported: null,
        settings,
      })
    ).toEqual([])
  })
})
