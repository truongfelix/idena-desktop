const {
  PEER_LEVELS,
  DEFAULT_PEER_LEVEL,
  IPFS_CONNECTION_LIMITS,
  DEFAULT_IPFS_CONNECTIONS,
  IPFS_CONNECTIONS_MARGIN,
  maxPeers,
  ipfsConnectionsAllow,
  ipfsConnectionsFor,
  nodeSupportsPeerLimits,
  peerLimitArgs,
} = require('./node-peers')

const ourHelp = [
  "   --maxinboundownshardpeers value  Incoming peer slots for peers of the node's own shard",
  '   --maxinboundpeers value  Incoming peer slots for peers of other shards',
  "   --maxoutboundownshardpeers value  Outgoing peer slots for peers of the node's own shard",
  '   --maxoutboundpeers value  Outgoing peer slots for peers of other shards',
  '   --ipfslowwater value  IPFS connections kept when the connection manager trims',
  '   --ipfshighwater value  IPFS connections above which the connection manager trims',
].join('\n')
const officialHelp = '   --apikey value  API key for an access'

const argsOf = (args) => {
  const map = {}
  for (let i = 0; i < args.length; i += 2) map[args[i]] = args[i + 1]
  return map
}

describe('peer levels', () => {
  it('are Eco, Normal and Hub with Normal by default', () => {
    expect(Object.keys(PEER_LEVELS)).toEqual(['eco', 'normal', 'hub'])
    expect(DEFAULT_PEER_LEVEL).toBe('normal')
    expect(['eco', 'normal', 'hub'].map(maxPeers)).toEqual([7, 18, 30])
  })

  it("have idena-go's low-power numbers for Eco and its defaults for Normal", () => {
    // idena-go config/flags.go LowPower* and Default*.
    expect(PEER_LEVELS.eco).toEqual({
      inboundOwnShard: 3,
      inboundOtherShards: 1,
      outboundOwnShard: 2,
      outboundOtherShards: 1,
    })
    expect(PEER_LEVELS.normal).toEqual({
      inboundOwnShard: 8,
      inboundOtherShards: 4,
      outboundOwnShard: 4,
      outboundOtherShards: 2,
    })
  })

  it('give Hub twice the incoming slots and the same outgoing ones', () => {
    expect(PEER_LEVELS.hub).toEqual({
      inboundOwnShard: 16,
      inboundOtherShards: 8,
      outboundOwnShard: 4,
      outboundOtherShards: 2,
    })
  })
})

describe('IPFS connection limits', () => {
  it("are 20, 50, 100 and none, with idena-go's 50 by default", () => {
    expect(IPFS_CONNECTION_LIMITS.map(({high}) => high)).toEqual([
      20, 50, 100, 0,
    ])
    expect(DEFAULT_IPFS_CONNECTIONS).toBe(50)
    // idena-go's default profile on a computer: LowWater 30, HighWater 50.
    expect(IPFS_CONNECTION_LIMITS[1]).toEqual({high: 50, low: 30})
  })

  it("leave room for the level's peers: 20 needs Eco, 50 Eco or Normal", () => {
    const levelsFor = (high) =>
      Object.keys(PEER_LEVELS).filter((level) =>
        ipfsConnectionsAllow(high, level)
      )
    expect(levelsFor(20)).toEqual(['eco'])
    expect(levelsFor(50)).toEqual(['eco', 'normal'])
    expect(levelsFor(100)).toEqual(['eco', 'normal', 'hub'])
    expect(levelsFor(0)).toEqual(['eco', 'normal', 'hub'])
    for (const {high, low} of IPFS_CONNECTION_LIMITS) {
      for (const level of levelsFor(high)) {
        if (high > 0)
          expect(low).toBeGreaterThanOrEqual(
            maxPeers(level) + IPFS_CONNECTIONS_MARGIN
          )
      }
    }
  })

  it('raise a limit too low for the level to the next it allows', () => {
    expect(ipfsConnectionsFor(20, 'eco')).toBe(20)
    expect(ipfsConnectionsFor(20, 'normal')).toBe(50)
    expect(ipfsConnectionsFor(20, 'hub')).toBe(100)
    expect(ipfsConnectionsFor(50, 'hub')).toBe(100)
    // Never lowered.
    expect(ipfsConnectionsFor(0, 'eco')).toBe(0)
    expect(ipfsConnectionsFor(100, 'eco')).toBe(100)
    // An unknown limit counts as the default.
    expect(ipfsConnectionsFor(undefined, 'normal')).toBe(50)
    expect(ipfsConnectionsFor(30, 'hub')).toBe(100)
  })
})

describe('peer limit arguments', () => {
  it('pass the level and the limit to a node that knows the flags', () => {
    expect(argsOf(peerLimitArgs('hub', 100, ourHelp))).toEqual({
      '--maxinboundownshardpeers': '16',
      '--maxinboundpeers': '8',
      '--maxoutboundownshardpeers': '4',
      '--maxoutboundpeers': '2',
      '--ipfslowwater': '50',
      '--ipfshighwater': '100',
    })
    expect(argsOf(peerLimitArgs('eco', 0, ourHelp))).toMatchObject({
      '--maxinboundownshardpeers': '3',
      '--ipfslowwater': '0',
      '--ipfshighwater': '0',
    })
  })

  it("pass Normal and 50 as idena-go's defaults", () => {
    expect(argsOf(peerLimitArgs('normal', 50, ourHelp))).toEqual({
      '--maxinboundownshardpeers': '8',
      '--maxinboundpeers': '4',
      '--maxoutboundownshardpeers': '4',
      '--maxoutboundpeers': '2',
      '--ipfslowwater': '30',
      '--ipfshighwater': '50',
    })
  })

  it('never pass a limit too low for the level', () => {
    expect(argsOf(peerLimitArgs('hub', 20, ourHelp))['--ipfshighwater']).toBe(
      '100'
    )
  })

  it('pass nothing to a node without the flags, or for an unknown level', () => {
    expect(peerLimitArgs('hub', 100, officialHelp)).toEqual([])
    expect(peerLimitArgs('hub', 100, undefined)).toEqual([])
    expect(peerLimitArgs('full', 100, ourHelp)).toEqual([])
    expect(peerLimitArgs(undefined, 100, ourHelp)).toEqual([])
    expect(nodeSupportsPeerLimits(ourHelp)).toBe(true)
    expect(nodeSupportsPeerLimits(officialHelp)).toBe(false)
  })
})
