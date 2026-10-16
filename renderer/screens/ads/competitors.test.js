import {AdBurnKey} from '../../shared/models/adBurnKey'
import {AdTarget} from '../../shared/models/adKey'
import {canReachSameViewer, competingBurns} from './competitors'

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

describe('one viewer for both ads', () => {
  const target = (fields) => new AdTarget(fields)

  it('needs the languages to meet', () => {
    expect(canReachSameViewer(target({language: 'fr'}), english)).toBe(false)
    expect(canReachSameViewer(target({language: 'EN'}), english)).toBe(true)
    expect(canReachSameViewer(anyone, english)).toBe(true)
    expect(canReachSameViewer(english, anyone)).toBe(true)
  })

  it('needs the OSes to meet', () => {
    const linux = target({language: 'en', os: 'linux'})
    expect(canReachSameViewer(linux, target({os: 'windows'}))).toBe(false)
    expect(canReachSameViewer(linux, english)).toBe(true)
  })

  it('is not kept apart by a minimum age or stake', () => {
    expect(
      canReachSameViewer(
        target({language: 'en', age: 10, stake: 5000}),
        target({language: 'en', age: 1, stake: 100})
      )
    ).toBe(true)
  })

  it('leaves out a burn for another language', () => {
    expect(
      competingBurns(
        [burn('bafyother', target({language: 'fr'}))],
        'bafyown',
        english,
        decodeTarget
      )
    ).toEqual([])
  })
})
