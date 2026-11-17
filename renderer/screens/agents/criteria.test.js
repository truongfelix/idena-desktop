import {criteriaNeeds, forgetAuthors, passes, readAuthors} from './criteria'

// B-266: whose an agent reads and whom it acts on, by the person's criteria on each author.

const A = `0x${'a'.repeat(40)}`
const B = `0x${'b'.repeat(40)}`
const none = {
  only: [],
  except: [],
  states: [],
  trustAbove: null,
  minAge: null,
  minStake: null,
}

describe('an author and the criteria', () => {
  test('each criterion, and all of them together', () => {
    const human = {state: 'Human', age: 10, stake: 5000, trust: 60}
    expect(passes(null, A, {})).toBe(true)
    expect(passes({...none, only: [B]}, A, human)).toBe(false)
    expect(passes({...none, except: [A]}, A, human)).toBe(false)
    expect(passes({...none, states: ['Verified', 'Human']}, A, human)).toBe(
      true
    )
    expect(passes({...none, states: ['Newbie']}, A, human)).toBe(false)
    expect(passes({...none, states: ['Vouched']}, A, {vouched: true})).toBe(
      true
    )
    expect(passes({...none, trustAbove: 50}, A, human)).toBe(true)
    expect(passes({...none, trustAbove: 60}, A, human)).toBe(false)
    expect(passes({...none, minAge: 10, minStake: 5000}, A, human)).toBe(true)
    expect(passes({...none, minStake: 5001}, A, human)).toBe(false)
    const words = {...none, mustWords: ['idena', 'flip'], notWords: ['scam']}
    expect(passes(words, A, human, 'A new FLIP today')).toBe(true)
    expect(passes(words, A, human, 'Hello')).toBe(false)
    expect(passes(words, A, human, 'Idena scam')).toBe(false)
    // Whole words: not "flip" in "flipper", nor "scam" in "scamper"; a like or a tip has no text: no words checked.
    expect(passes(words, A, human, 'A flipper')).toBe(false)
    expect(passes(words, A, human, 'Idena, scampering')).toBe(true)
    expect(passes(words, A, human, null)).toBe(true)
    // As Social hides words: accents ignored.
    expect(passes({...none, notWords: ['cafe']}, A, human, 'Un Café ?')).toBe(
      false
    )
    expect(
      passes(
        {...none, states: ['Human'], trustAbove: 50, minStake: 1000},
        A,
        human
      )
    ).toBe(true)
  })

  test('a fact not read passes no criterion that needs it', () => {
    expect(passes({...none, states: ['Human']}, A, {})).toBe(false)
    expect(passes({...none, trustAbove: 0}, A, {})).toBe(false)
    expect(passes({...none, minAge: 0}, A, undefined)).toBe(false)
  })
})

describe("the authors' facts", () => {
  beforeEach(forgetAuthors)

  test('only what the criteria need is read, once, and kept a while', async () => {
    // Vouched reads the authors' own states too: a vouched member has no identity of its own.
    expect(criteriaNeeds([null, {...none, states: ['Vouched']}])).toEqual({
      identity: true,
      vouched: true,
      trust: false,
      named: false,
    })
    expect(criteriaNeeds([{...none, trustAbove: 1}])).toEqual({
      identity: false,
      vouched: false,
      trust: true,
      named: false,
    })
    // A claimed profile name (B-281) is read from the profiles contract, for the authors asked only.
    const named = criteriaNeeds([{...none, named: true}])
    expect(named).toEqual({
      identity: false,
      vouched: false,
      trust: false,
      named: true,
    })
    const names = jest.fn(async (method, list) =>
      list.map((_, i) =>
        i === 0 ? {result: 'ann'} : {error: {message: 'data is nil'}}
      )
    )
    const read = await readAuthors([A, B], named, {
      settled: names,
      call: jest.fn(),
      now: 1,
    })
    expect(names).toHaveBeenCalledTimes(1)
    expect(names.mock.calls[0][0]).toBe('contract_readMap')
    expect(read[A].named).toBe(true)
    expect(read[B.toLowerCase()].named).toBe(false)
    expect(passes({...none, named: true}, A, read[A])).toBe(true)
    expect(passes({...none, named: true}, B, read[B.toLowerCase()])).toBe(false)
    // A read that failed leaves the fact out: the criterion does not pass.
    forgetAuthors()
    const failed = await readAuthors([A], named, {
      settled: jest.fn().mockRejectedValue(new Error('down')),
      call: jest.fn(),
      now: 1,
    })
    expect(passes({...none, named: true}, A, failed[A])).toBe(false)
    forgetAuthors()
    const settled = jest.fn(async (method, list) =>
      list.map(([address]) => ({
        result: {
          state: address === A ? 'Human' : 'Newbie',
          age: 3,
          stake: '12.5',
        },
      }))
    )
    const needs = criteriaNeeds([{...none, minStake: 1}])
    const facts = await readAuthors([A, B.toUpperCase()], needs, {
      settled,
      call: jest.fn(),
      now: 1000,
    })
    expect(facts[A]).toEqual({state: 'Human', age: 3, stake: 12.5})
    expect(facts[B].state).toBe('Newbie')
    await readAuthors([A], needs, {settled, call: jest.fn(), now: 2000})
    expect(settled).toHaveBeenCalledTimes(1)
    // Seen at each run, it is still read again once past its time.
    await readAuthors([A], needs, {
      settled,
      call: jest.fn(),
      now: 1000 + 29 * 60 * 1000,
    })
    expect(settled).toHaveBeenCalledTimes(1)
    await readAuthors([A], needs, {
      settled,
      call: jest.fn(),
      now: 1000 + 31 * 60 * 1000,
    })
    expect(settled).toHaveBeenCalledTimes(2)
    // B-286: an author a rule refused is read again, unless it was read less than a minute ago.
    const before = settled.mock.calls.length
    const at = 1000 + 31 * 60 * 1000
    await readAuthors([A], needs, {
      settled,
      call: jest.fn(),
      now: at + 30 * 1000,
      again: true,
    })
    expect(settled).toHaveBeenCalledTimes(before)
    await readAuthors([A], needs, {
      settled,
      call: jest.fn(),
      now: at + 2 * 60 * 1000,
      again: true,
    })
    expect(settled).toHaveBeenCalledTimes(before + 1)
  })

  test('Vouched: a vouched member in standing (no identity of its own, its voucher validated)', async () => {
    const C = `0x${'c'.repeat(40)}`
    const V = `0x${'d'.repeat(40)}`
    const states = {
      [A]: 'Undefined',
      [B]: 'Human',
      [C]: 'Undefined',
      [V]: 'Human',
    }
    const settled = jest.fn(async (method, list) => {
      if (method === 'contract_readMap')
        // A and B vouched for by V; C has no voucher.
        return list.map(([, , key]) =>
          key === `0x${Buffer.from(C).toString('hex')}`
            ? {error: new Error('data is nil')}
            : {result: V}
        )
      return list.map(([address]) => ({result: {state: states[address]}}))
    })
    const facts = await readAuthors(
      [A, B, C],
      criteriaNeeds([{...none, states: ['Vouched']}]),
      {settled, call: jest.fn()}
    )
    expect(facts[A].vouched).toBe(true)
    // B has an identity of its own: not a vouched member; C has no voucher.
    expect(facts[B].vouched).toBe(false)
    expect(facts[C].vouched).toBe(false)
  })

  test("a voucher's failed read leaves out only the members it vouches for", async () => {
    const C = `0x${'c'.repeat(40)}`
    const V = `0x${'d'.repeat(40)}`
    const W = `0x${'e'.repeat(40)}`
    const settled = jest.fn(async (method, list) => {
      if (method === 'contract_readMap')
        return list.map(([, , key]) => ({
          result: key === `0x${Buffer.from(A).toString('hex')}` ? V : W,
        }))
      return list.map(([address]) =>
        address === W
          ? {error: new Error('node busy')}
          : {result: {state: address === V ? 'Human' : 'Undefined'}}
      )
    })
    const facts = await readAuthors(
      [A, C],
      criteriaNeeds([{...none, states: ['Vouched']}]),
      {settled, call: jest.fn()}
    )
    expect(facts[A].vouched).toBe(true)
    // C's voucher could not be read: left out (asked again next run), never counted as not vouched.
    expect('vouched' in facts[C]).toBe(false)
  })

  test('a read that fails leaves the facts out', async () => {
    const settled = jest.fn(async () => {
      throw new Error('node down')
    })
    const facts = await readAuthors(
      [A],
      criteriaNeeds([{...none, minAge: 1}]),
      {
        settled,
        call: jest.fn(),
      }
    )
    expect(facts[A]).toEqual({})
    expect(passes({...none, minAge: 1}, A, facts[A])).toBe(false)
  })
})
