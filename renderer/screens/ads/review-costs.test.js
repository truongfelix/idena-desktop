import {
  adReviewDeposit,
  adVotingDefaults,
  isAdReviewCommittee,
  validateAdVoting,
} from './utils'

describe('ad review deposit', () => {
  it('is what the contract asks, 5000 iDNA below 300 identities', () => {
    // It was 5000/N x 300: 13,157.9 iDNA at 114 identities, 8,158 of them paid to the oracles.
    expect(adReviewDeposit(114)).toBe(5000)
    expect(adReviewDeposit(190)).toBe(5000)
    expect(adReviewDeposit(300)).toBe(5000)
  })

  it('is 300 oracle rewards above 300 identities', () => {
    expect(adReviewDeposit(500)).toBeCloseTo(3000, 6)
    expect(adReviewDeposit(1000)).toBeCloseTo(1500, 6)
  })
})

describe('ad review committee', () => {
  it('accepts the committee the contract stores: min(300, network size)', () => {
    // Two ad reviews on mainnet (indexer, 2026): 128 and 190 oracles, owner deposit 5000.
    expect(
      isAdReviewCommittee({committeeSize: 128, ownerDeposit: '5000'})
    ).toBe(true)
    expect(
      isAdReviewCommittee({
        committeeSize: 190,
        ownerDeposit: '4999.999999999999995',
      })
    ).toBe(true)
    expect(
      isAdReviewCommittee({committeeSize: 300, ownerDeposit: '3000'})
    ).toBe(true)
  })

  it('refuses a small committee chosen by the author', () => {
    expect(isAdReviewCommittee({committeeSize: 5, ownerDeposit: '219.3'})).toBe(
      false
    )
    expect(
      isAdReviewCommittee({committeeSize: 128, ownerDeposit: '2000'})
    ).toBe(false)
    expect(isAdReviewCommittee({committeeSize: 0, ownerDeposit: '5000'})).toBe(
      false
    )
  })

  it('validates a mainnet-like ad review voting', () => {
    const votingParams = {
      votingDuration: adVotingDefaults.votingDuration,
      publicVotingDuration: adVotingDefaults.publicVotingDuration,
      quorum: adVotingDefaults.quorum,
      committeeSize: adVotingDefaults.committeeSize,
    }
    const voting = {
      ...votingParams,
      committeeSize: 128,
      ownerDeposit: '5000',
      options: adVotingDefaults.options,
    }
    expect(validateAdVoting({ad: {votingParams}, voting})).toBe(true)
    expect(
      validateAdVoting({
        ad: {votingParams},
        voting: {...voting, committeeSize: 5, ownerDeposit: '219'},
      })
    ).toBe(false)
    expect(
      validateAdVoting({ad: {votingParams}, voting: {...voting, quorum: 50}})
    ).toBe(false)
  })
})
