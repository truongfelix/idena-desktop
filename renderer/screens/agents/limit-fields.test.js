import {readNumber} from './limit-fields'

// B-269: the money fields keep amounts to the hundredth; one that would round to 0 is refused, never saved as 0.
describe('a limit as the fields read it', () => {
  test('whole numbers, or amounts to the hundredth', () => {
    expect(readNumber('3')).toBe(3)
    expect(readNumber('2.5')).toBeNull()
    expect(readNumber('0.123', {whole: false})).toBe(0.12)
    expect(readNumber('0', {whole: false})).toBe(0)
    expect(readNumber('0.004', {whole: false})).toBeNull()
    expect(readNumber('-1', {whole: false})).toBeNull()
    expect(readNumber('', {whole: false})).toBeNull()
  })
})
