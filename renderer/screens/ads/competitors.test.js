import {AdBurnKey} from '../../shared/models/adBurnKey'
import {AdTarget} from '../../shared/models/adKey'
import {competingBurns} from './competitors'

const english = new AdTarget({language: 'en'})
const anyone = new AdTarget({})

const burn = (cid, target) => ({
  amount: '10',
  key: new AdBurnKey({cid, target: target.toHex()}).toHex(),
})

const decodeTarget = (hex) => AdTarget.fromHex(hex)

describe('competing ads', () => {
  // The three burns of the devnet check (2026-10-16): the ad's own, another ad for the same audience, the same
  // other ad for anyone.
  const burns = [
    burn('bafyown', english),
    burn('bafyother', english),
    burn('bafyother', anyone),
  ]

  it('counts the other ads for exactly the same audience', () => {
    const found = competingBurns(burns, 'bafyown', english, decodeTarget)
    expect(found.map(({key}) => AdBurnKey.fromHex(key).cid)).toEqual([
      'bafyother',
      'bafyother',
    ])
  })

  it('leaves out the ad itself', () => {
    expect(
      competingBurns(
        [burn('bafyown', anyone)],
        'bafyown',
        english,
        decodeTarget
      )
    ).toEqual([])
  })
})
