import {
  CRITERIA_STATES,
  addressList,
  criteriaLine,
  topicList,
  wordList,
} from './criteria-fields'
import {ONLY_TO} from './do-row'
import {WHO_READS} from './read-row'

const main = require('../../../main/agent/criteria')

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

describe('the page and the main process name the same', () => {
  test('actions with criteria and identity states', () => {
    expect(ONLY_TO).toEqual(main.ONLY_TO_ACTIONS)
    expect(WHO_READS).toEqual(main.WHO_ACTIONS)
    expect([...CRITERIA_STATES].sort()).toEqual([...main.STATES].sort())
  })
})

describe('a profile name and topics (B-281)', () => {
  test('said in the line after the other criteria; topics typed with or without r/', () => {
    expect(
      criteriaLine(
        {
          only: [],
          except: [],
          states: ['Human'],
          trustAbove: null,
          minAge: null,
          minStake: null,
          named: true,
          topics: ['flips', 'validation'],
        },
        t,
        (s) => s
      )
    ).toBe('Human · with a profile name · in r/flips, r/validation')
    expect(topicList('r/Flips, validation ,')).toEqual(['flips', 'validation'])
    // What the editor saves is what the main process keeps.
    expect(
      main.normalizeCriteria(
        {named: true, topics: topicList('r/Flips')},
        {withWords: true}
      )
    ).toMatchObject({named: true, topics: ['flips']})
  })
})
