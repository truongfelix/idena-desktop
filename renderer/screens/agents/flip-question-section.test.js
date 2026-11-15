import {missingParts} from './flip-question-section'

jest.mock('../settings/agent/api', () => ({}))

describe("the flip question's parts the app fills", () => {
  test('each kept once, or named as missing', () => {
    expect(missingParts('a {RULES} b {ANSWER_FORMAT}')).toEqual([])
    expect(missingParts('a {RULES}')).toEqual(['{ANSWER_FORMAT}'])
    expect(missingParts('{RULES} {RULES} {ANSWER_FORMAT}')).toEqual(['{RULES}'])
    expect(missingParts('')).toEqual(['{RULES}', '{ANSWER_FORMAT}'])
  })
})
