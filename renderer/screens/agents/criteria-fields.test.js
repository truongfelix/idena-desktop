import {addressList, criteriaLine, wordList} from './criteria-fields'

// B-266: the criteria editor's folded line and its lists.
const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))

describe('the criteria in words', () => {
  test('everyone without any; each criterion set, in order', () => {
    expect(criteriaLine(null, t, (s) => s)).toBe('Everyone')
    expect(
      criteriaLine(
        {
          only: [],
          except: ['0x1'],
          states: ['Human', 'Verified'],
          trustAbove: 50,
          minAge: null,
          minStake: 1000,
          mustWords: ['idena'],
          notWords: [],
        },
        t,
        (s) => (s === 'Verified' ? 'Validated' : s)
      )
    ).toBe(
      'not 1 chosen · Human, Validated · Trust above 50 · stake 1000+ iDNA · with “idena”'
    )
  })

  test('addresses by line, comma or space; words by comma', () => {
    expect(addressList(' 0xA\n0xB, 0xC ;0xD ')).toEqual([
      '0xA',
      '0xB',
      '0xC',
      '0xD',
    ])
    expect(wordList('idena, flip ,, ')).toEqual(['idena', 'flip'])
  })
})
