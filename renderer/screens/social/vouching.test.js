import {
  challengeStep,
  isActingMember,
  isVouchable,
  parseChallenge,
  readMembers,
  readOffer,
  readOffersTo,
  vouchCap,
  vouchedExtra,
} from './vouching'

const alice = '0xaaaa000000000000000000000000000000000001'
const bob = '0xbbbb000000000000000000000000000000000002'
const holder = '0xcccc000000000000000000000000000000000003'

describe('a challenge, 3 calls in a row', () => {
  it('starts with the first call', () => {
    expect(challengeStep(null, 10, holder)).toEqual({
      step: 1,
      canCall: true,
      frees: false,
      since: 10,
    })
  })

  it('goes on in the next epochs and frees the name at the third call', () => {
    const first = parseChallenge(`10:10:${holder}`)
    expect(challengeStep(first, 11, holder)).toMatchObject({
      step: 2,
      canCall: true,
      frees: false,
    })
    const second = parseChallenge(`10:11:${holder}`)
    expect(challengeStep(second, 12, holder)).toMatchObject({
      step: 3,
      canCall: true,
      frees: true,
    })
  })

  it('waits for the next epoch after a call in this one', () => {
    const first = parseChallenge(`10:10:${holder}`)
    expect(challengeStep(first, 10, holder)).toMatchObject({
      step: 2,
      canCall: false,
      frees: false,
    })
  })

  it('starts again after a skipped epoch, or for another holder', () => {
    const first = parseChallenge(`10:10:${holder}`)
    expect(challengeStep(first, 12, holder)).toMatchObject({
      step: 1,
      frees: false,
      since: 12,
    })
    expect(challengeStep(first, 11, alice)).toMatchObject({
      step: 1,
      frees: false,
    })
  })
})

describe('vouched members', () => {
  it('caps the members by the voucher state', () => {
    expect([
      vouchCap('Human'),
      vouchCap('Verified'),
      vouchCap('Newbie'),
      vouchCap('Zombie'),
    ]).toEqual([5, 3, 1, 0])
    expect([
      isVouchable('Undefined'),
      isVouchable('Killed'),
      isVouchable(undefined),
      isVouchable('Newbie'),
    ]).toEqual([true, true, true, false])
  })

  it('acts as a member only without an identity and with a validated voucher', () => {
    expect(
      isActingMember({
        voucher: alice,
        state: 'Undefined',
        voucherState: 'Human',
      })
    ).toBe(true)
    expect(
      isActingMember({
        voucher: alice,
        state: 'Undefined',
        voucherState: 'Suspended',
      })
    ).toBe(false)
    // A member who got an identity acts on its own.
    expect(
      isActingMember({voucher: alice, state: 'Newbie', voucherState: 'Human'})
    ).toBe(false)
    expect(isActingMember({voucher: null, state: 'Undefined'})).toBe(false)
  })

  it('sends 25,000 gas at the fee per gas, a tenth more, rounded up', () => {
    // 0.01 iDNA per gas: 250 iDNA, 275 with the margin.
    expect(vouchedExtra('10000000000000000')).toBe('275')
    // Mainnet 2026-10-15: 0.0000885 iDNA per gas.
    expect(vouchedExtra('88500000000000')).toBe('2.43375')
  })

  it('reads offers, members and one offer from the maps', async () => {
    const maps = {[`o:${bob}:${alice}`]: '7', [`m:${alice}:${bob}`]: '8'}
    const call = async (method, [, prefix]) => ({
      items: Object.keys(maps)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({key: k.slice(prefix.length), value: maps[k]})),
      continuationToken: null,
    })
    expect(await readOffersTo(call, bob)).toEqual([{voucher: alice, epoch: 7}])
    expect(await readMembers(call, alice)).toEqual([{member: bob, epoch: 8}])
    const text = (hex) =>
      Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('utf8')
    const settled = async (method, list) =>
      list.map(([, map, key]) => {
        const k = `${map}${text(key)}`
        return k in maps ? {result: maps[k]} : {error: new Error('data is nil')}
      })
    expect(await readOffer(settled, bob, alice)).toBe(7)
    expect(await readOffer(settled, alice, bob)).toBe(null)
  })
})
