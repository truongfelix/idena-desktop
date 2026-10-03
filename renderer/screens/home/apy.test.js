import {
  apy,
  blockReward,
  fetchNetworkRewards,
  finalCommitteeSize,
  miningRewardPerBlock,
  networkRewardsOf,
  stakeWeight,
} from './apy'

const GOD = '0x4d60dc6a2cba8c3ef1ba5e1eba5c12c54cee6b61'

describe('APY from the node (same rules as the phone app)', () => {
  it('takes 70% of the validators for the final committee', () => {
    expect(finalCommitteeSize(5)).toBe(5)
    expect(finalCommitteeSize(8)).toBe(8)
    expect(finalCommitteeSize(9)).toBe(6)
    expect(finalCommitteeSize(43)).toBe(30)
    expect(finalCommitteeSize(200)).toBe(100)
  })

  it('shares the whole block reward equally between equal stakes', () => {
    for (const validators of [3, 9, 43, 200]) {
      const weight = stakeWeight(5000)
      expect(miningRewardPerBlock(weight, validators, weight)).toBeCloseTo(
        6 / validators,
        9
      )
    }
  })

  it('gives the proposer the block reward and members the committee reward', () => {
    const weight = stakeWeight(5000)
    expect(blockReward(weight, true, false, 30, weight)).toBeCloseTo(1, 9)
    expect(blockReward(weight, false, true, 30, weight)).toBeCloseTo(5 / 30, 9)
    expect(blockReward(weight, true, true, 30, weight)).toBeCloseTo(
      1 + 5 / 30,
      9
    )
  })

  it('earns more mining with a bigger stake, but less than proportionally', () => {
    const average = stakeWeight(1000)
    const single = miningRewardPerBlock(stakeWeight(1000), 43, average)
    const tenTimes = miningRewardPerBlock(stakeWeight(10000), 43, average)
    expect(tenTimes).toBeGreaterThan(single)
    expect(tenTimes).toBeLessThan(10 * single)
  })

  it('shares a day of staking reward by weight', () => {
    // One day = 4,320 blocks x 6 iDNA x 18% = 4,665.6 iDNA; a quarter of the weight here.
    const weight = stakeWeight(1000)
    const result = apy(1000, {
      totalStakingWeight: 4 * weight,
      validators: 0,
      averageValidatorWeight: 0,
      epochDays: 1,
      proposedBlockShare: 1,
    })
    expect(result.stakingPerEpoch).toBeCloseTo(1166.4, 6)
    expect(result.miningPerEpoch).toBe(0)
    expect(result.yearly).toBeCloseTo((1166.4 / 1000) * 365, 6)
  })

  it('counts mining only on blocks with a proposal', () => {
    const weight = stakeWeight(1000)
    const result = apy(1000, {
      totalStakingWeight: 1e12,
      validators: 43,
      averageValidatorWeight: weight,
      epochDays: 1,
      proposedBlockShare: 0.9,
    })
    expect(result.miningPerEpoch).toBeCloseTo((4320 * 0.9 * 6) / 43, 6)
  })

  it('has no APY without data', () => {
    const net = {
      totalStakingWeight: 1,
      validators: 10,
      averageValidatorWeight: 1,
      epochDays: 5,
      proposedBlockShare: 1,
    }
    expect(apy(0, net)).toBeNull()
    expect(apy(100, {...net, epochDays: 0})).toBeNull()
    expect(apy(100, {...net, totalStakingWeight: 0})).toBeNull()
    expect(apy(100, undefined)).toBeNull()
  })

  it('weighs a stake as stake^0.9', () => {
    expect(stakeWeight(1000)).toBeCloseTo(1000 ** 0.9, 9)
    expect(stakeWeight(0)).toBe(0)
  })
})

describe('network data of the APY', () => {
  const identities = [
    {address: '0xA1', state: 'Human', stake: '1000', online: true},
    {address: '0xa2', state: 'Verified', stake: '1000', online: false},
    {address: '0xa3', state: 'Newbie', stake: '1000', delegatee: '0xPOOL'},
    {address: '0xa4', state: 'Newbie', stake: '1000', delegatee: '0xoff'},
    {address: '0xa5', state: 'Candidate', stake: '5000', online: true},
    {address: '0xa6', state: 'Killed', stake: '5000'},
  ]
  const epoch = {
    nextValidation: '2026-10-09T15:00:00Z',
    startBlock: 100,
  }
  const epochStart = Date.parse('2026-10-04T15:00:00Z') / 1000

  it('counts validated stakes and online validators, delegators through online pools', () => {
    const net = networkRewardsOf({
      identities,
      onlinePools: new Set(['0xpool']),
      godStake: '1000',
      epochStart,
      nextValidation: epoch.nextValidation,
      recentBlocks: [{isEmpty: false}, {isEmpty: true}, {}, {isEmpty: false}],
    })
    // 4 validated identities + the god address, 1000 iDNA each.
    expect(net.totalStakingWeight).toBeCloseTo(5 * stakeWeight(1000), 6)
    // 0xa1 online itself, 0xa3 through its online pool.
    expect(net.validators).toBe(2)
    expect(net.averageValidatorWeight).toBeCloseTo(stakeWeight(1000), 6)
    expect(net.epochDays).toBeCloseTo(5, 9)
    expect(net.proposedBlockShare).toBeCloseTo(0.75, 9)
  })

  it('does not count the god address twice', () => {
    const net = networkRewardsOf({
      identities: [{address: GOD, state: 'Human', stake: '1000'}],
      onlinePools: new Set(),
      godStake: '1000',
      epochStart,
      nextValidation: epoch.nextValidation,
      recentBlocks: [],
    })
    expect(net.totalStakingWeight).toBeCloseTo(stakeWeight(1000), 6)
    expect(net.proposedBlockShare).toBe(1)
  })

  it('reads it from the node', async () => {
    const calls = []
    const rpc = async (method, ...params) => {
      calls.push([method, ...params])
      switch (method) {
        case 'dna_identities':
          return identities
        case 'dna_identity':
          return {online: params[0] === '0xpool'}
        case 'dna_getBalance':
          return {stake: '1000'}
        case 'dna_epoch':
          return epoch
        case 'bcn_lastBlock':
          return {height: 1000}
        case 'bcn_blockAt':
          return params[0] === 100
            ? {timestamp: epochStart}
            : {isEmpty: params[0] % 2 === 0}
        default:
          throw new Error(method)
      }
    }
    const net = await fetchNetworkRewards(rpc, 10)
    expect(net.validators).toBe(2)
    expect(net.epochDays).toBeCloseTo(5, 9)
    expect(net.proposedBlockShare).toBeCloseTo(0.5, 9)
    expect(calls.filter(([method]) => method === 'dna_identity')).toEqual([
      ['dna_identity', '0xpool'],
      ['dna_identity', '0xoff'],
    ])
    expect(
      calls.filter(([method]) => method === 'bcn_blockAt').map(([, h]) => h)
    ).toEqual([100, 991, 992, 993, 994, 995, 996, 997, 998, 999, 1000])
  })
})
