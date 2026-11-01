import {missingFlipPairs} from './missing-flips'

// The owner's user after restoring an old backup (2026-11-01): five flips on the chain, two with a draft here
// (pairs 0 and 3), three without.
const keywordPairs = [0, 1, 2, 3, 4].map((id) => ({
  id,
  words: [id * 2, id * 2 + 1],
  used: true,
}))
const flipsWithPair = [
  {hash: 'local-snail', pair: 0},
  {hash: 'lion', pair: 1},
  {hash: 'peanut', pair: 2},
  {hash: 'local-bigben', pair: 3},
  {hash: 'other', pair: 4},
]

describe('the keywords of a flip missing on this computer', () => {
  it("are those of its own pair, never another flip's", () => {
    const result = missingFlipPairs(
      ['lion', 'peanut', 'other'],
      flipsWithPair,
      keywordPairs
    )
    expect(result.map(({hash, pair}) => [hash, pair && pair.id])).toEqual([
      ['lion', 1],
      ['peanut', 2],
      ['other', 4],
    ])
  })

  it('are unknown when the node does not tell the pair', () => {
    expect(missingFlipPairs(['lion'], undefined, keywordPairs)).toEqual([
      {hash: 'lion', pair: null},
    ])
    expect(missingFlipPairs(['nowhere'], flipsWithPair, keywordPairs)).toEqual([
      {hash: 'nowhere', pair: null},
    ])
    expect(
      missingFlipPairs(['lion'], flipsWithPair, [{id: 0, words: [0, 1]}])
    ).toEqual([{hash: 'lion', pair: null}])
  })
})
