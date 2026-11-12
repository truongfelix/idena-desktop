const {
  REPORT_CONFIDENCE,
  checkFlip,
  firstJsonObject,
  flipQuestion,
  readFlipAnswer,
} = require('./flips')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 4, 5]).toString('base64')

const flip = (extra = {}) => ({
  images: [PNG, JPEG, PNG, JPEG],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  ...extra,
})

describe('agent flips: what the renderer sends', () => {
  test('four pictures, two orders, the keywords', () => {
    const checked = checkFlip(
      flip({
        words: [{name: 'sign', desc: 'omen'}, {name: 'Sunday'}, {name: 'x'}],
      })
    )
    expect(checked.images.map((i) => i.mediaType)).toEqual([
      'image/png',
      'image/jpeg',
      'image/png',
      'image/jpeg',
    ])
    expect(checked.words).toEqual([
      {name: 'sign', desc: 'omen'},
      {name: 'Sunday', desc: ''},
    ])
  })

  test('anything else is refused', () => {
    expect(() => checkFlip(flip({images: [PNG, PNG, PNG]}))).toThrow('four')
    expect(() =>
      checkFlip(
        flip({
          images: [PNG, PNG, PNG, Buffer.from('GIF89a').toString('base64')],
        })
      )
    ).toThrow('picture')
    expect(() =>
      checkFlip(
        flip({
          orders: [
            [0, 1, 2, 4],
            [0, 1, 2, 3],
          ],
        })
      )
    ).toThrow('order')
    expect(() => checkFlip(flip({orders: [[0, 1, 2, 3]]}))).toThrow(
      'two orders'
    )
    expect(() => checkFlip(null)).toThrow()
  })

  test('the question shows each story in its order', () => {
    const checked = checkFlip(flip())
    const {parts} = flipQuestion(checked)
    const images = parts.filter((p) => p.type === 'image')
    expect(images).toHaveLength(8)
    expect(images.slice(4).map((p) => p.mediaType)).toEqual([
      'image/jpeg',
      'image/png',
      'image/jpeg',
      'image/png',
    ])
    expect(parts[0].text).toMatch(/No keywords/u)
  })
})

describe('agent flips: the model answer', () => {
  test('the JSON in a code block or a sentence', () => {
    expect(
      firstJsonObject('Sure! ```json\n{"answer": "left", "note": "a {b}"}\n```')
    ).toEqual({answer: 'left', note: 'a {b}'})
    expect(firstJsonObject('{bad} then {"answer":"right"}')).toEqual({
      answer: 'right',
    })
    expect(firstJsonObject('no json')).toBeNull()
  })

  test('an unreadable answer is no answer', () => {
    expect(readFlipAnswer('I think left', {hasWords: false})).toEqual({
      answer: null,
      confidence: 0,
      relevance: null,
      report: false,
    })
    expect(
      readFlipAnswer('{"answer": "both", "confidence": 3}', {hasWords: false})
    ).toMatchObject({answer: null, confidence: 1})
  })

  test('a report only when very sure, and only with keywords', () => {
    const sure = `{"answer":"left","confidence":${REPORT_CONFIDENCE},"keywords":"not shown","report":true}`
    expect(readFlipAnswer(sure, {hasWords: true})).toEqual({
      answer: 'left',
      confidence: REPORT_CONFIDENCE,
      relevance: 'irrelevant',
      report: true,
    })
    expect(readFlipAnswer(sure, {hasWords: false}).report).toBe(false)
    const unsure = sure.replace(`${REPORT_CONFIDENCE}`, '0.6')
    expect(readFlipAnswer(unsure, {hasWords: true})).toMatchObject({
      report: false,
      relevance: null,
    })
  })

  test('keywords shown: the flip approved', () => {
    expect(
      readFlipAnswer(
        '{"answer":"right","confidence":0.7,"keywords":"shown","report":false}',
        {hasWords: true}
      )
    ).toMatchObject({answer: 'right', relevance: 'relevant', report: false})
  })
})
