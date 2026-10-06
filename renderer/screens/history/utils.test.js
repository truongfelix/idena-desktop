import {
  CeremonyResult,
  HistoryTab,
  ceremonyResult,
  ceremonyRows,
  counterParty,
  earnedRewards,
  miningRows,
  parseHistoryTab,
  signedAmount,
  txTypeName,
} from './utils'

function summary(fields = {}) {
  return {
    epoch: 229,
    validationFailed: false,
    participated: true,
    prevState: 'Verified',
    state: 'Verified',
    missed: false,
    shortAnswers: {point: 5, flipsCount: 6},
    rewards: {
      staking: {earned: '1.5', missed: '0'},
      flips: {earned: '2.25', missed: null},
      invitations: {earned: '0', missed: '3'},
    },
    ...fields,
  }
}

// As dna_identityHistory answers: current epoch first, then the past ones newest first.
const history = {
  address: '0x1',
  own: true,
  epoch: 230,
  ceremoniesComplete: true,
  epochs: [
    {epoch: 230, ceremony: null, validated: null, summary: null},
    {
      epoch: 229,
      ceremony: {height: 300, time: 1791128034},
      validated: true,
      summary: summary(),
      transactions: {sent: 4, flips: 3, shortAnswers: true, longAnswers: true},
      mining: {
        proposedBlocks: 2,
        proposerReward: '4.5',
        committeeBlocks: 100,
        committeeReward: '10',
        penaltyBurnt: '0.5',
      },
    },
    {
      epoch: 228,
      ceremony: {height: 200, time: 1790696042},
      validated: null,
      summary: null,
      transactions: {sent: 3, flips: 0, shortAnswers: true, longAnswers: true},
    },
    {epoch: 227, ceremony: {height: 100, time: 1}, validated: true},
    {epoch: 226, ceremony: {height: 50, time: 1}, validated: false},
    {epoch: 225, ceremony: {height: 40, time: 1}, validated: null},
  ],
  scores: [
    {epoch: null, shortPoints: 3, shortFlips: 4},
    {epoch: 228, shortPoints: 4, shortFlips: 4},
    {epoch: 229, shortPoints: 5, shortFlips: 6},
  ],
}

describe('History page', () => {
  it('reads the tab from the address bar', () => {
    expect(parseHistoryTab('mining')).toBe(HistoryTab.Mining)
    expect(parseHistoryTab(undefined)).toBe(HistoryTab.Ceremonies)
    expect(parseHistoryTab('other')).toBe(HistoryTab.Ceremonies)
  })

  it('adds the earned rewards of a summary', () => {
    expect(earnedRewards(summary())).toBe(3.75)
    expect(earnedRewards(null)).toBe(0)
  })

  it('tells the ceremony result from the summary first, then the validator flag', () => {
    expect(ceremonyResult({summary: summary({state: 'Suspended'})})).toEqual({
      kind: CeremonyResult.NotValidated,
      prevState: 'Verified',
      state: 'Suspended',
    })
    expect(
      ceremonyResult({
        summary: summary({participated: false, state: 'Undefined'}),
        validated: true,
      }).kind
    ).toBe(CeremonyResult.Absent)
    expect(
      ceremonyResult({summary: summary({validationFailed: true})}).kind
    ).toBe(CeremonyResult.Failed)
    expect(ceremonyResult({validated: true}).kind).toBe(
      CeremonyResult.Validated
    )
    expect(ceremonyResult({validated: false}).kind).toBe(
      CeremonyResult.NotValidated
    )
    expect(ceremonyResult({}).kind).toBe(CeremonyResult.Unknown)
  })

  it('lists the past ceremonies down to the first with activity', () => {
    const rows = ceremonyRows(history)
    expect(rows.map(({epoch}) => epoch)).toEqual([229, 228, 227])
    expect(rows[0]).toMatchObject({
      time: 1791128034,
      score: {points: 5, flips: 6},
      flipsSubmitted: 3,
      shortAnswers: true,
      earned: 3.75,
      missed: 3,
    })
    // No summary: the score with that epoch, the answers sent.
    expect(rows[1]).toMatchObject({
      score: {points: 4, flips: 4},
      result: {kind: CeremonyResult.Unknown},
      longAnswers: true,
    })
    expect(rows[2].result.kind).toBe(CeremonyResult.Validated)
    expect(rows[2].score).toBeNull()
  })

  it('lists nothing for an address without activity', () => {
    expect(
      ceremonyRows({
        epoch: 230,
        epochs: [
          {epoch: 230},
          {epoch: 229, ceremony: {height: 1, time: 1}, validated: false},
          {
            epoch: 228,
            ceremony: {height: 1, time: 1},
            summary: summary({participated: false, state: 'Undefined'}),
          },
        ],
      })
    ).toEqual([])
    expect(ceremonyRows(undefined)).toEqual([])
  })

  it('adds up the mining', () => {
    const {rows, totals} = miningRows(history)
    expect(rows).toEqual([
      {
        epoch: 229,
        proposedBlocks: 2,
        proposerReward: 4.5,
        committeeBlocks: 100,
        committeeReward: 10,
        penaltyBurnt: 0.5,
        total: 14,
      },
    ])
    expect(totals).toEqual({proposedBlocks: 2, committeeBlocks: 100, total: 14})
  })

  it('names transactions and signs amounts from the address', () => {
    expect(txTypeName({type: 'submitShortAnswers'})).toBe('Short answers')
    expect(txTypeName({type: 'online', payload: '0x'})).toBe(
      'Mining status Off'
    )
    expect(txTypeName({type: 'somethingNew'})).toBe('somethingNew')
    const tx = {from: '0xAB', to: '0xcd', amount: '2.5'}
    expect(signedAmount(tx, '0xab')).toBe(-2.5)
    expect(signedAmount(tx, '0xcd')).toBe(2.5)
    expect(signedAmount({...tx, amount: '0'}, '0xab')).toBe(0)
    expect(counterParty(tx, '0xab')).toBe('0xcd')
    expect(counterParty(tx, '0xcd')).toBe('0xAB')
  })
})
