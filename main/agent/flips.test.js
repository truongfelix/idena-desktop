const {
  REPORT_REASONS,
  REPORT_THRESHOLDS,
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
    expect(firstJsonObject('{"a": "}"} more')).toEqual({a: '}'})
    expect(firstJsonObject('{ never closed {"answer":"left"}')).toBeNull()
  })

  test('a long reply of braces is read in one pass', () => {
    const start = Date.now()
    expect(firstJsonObject('{'.repeat(1024 * 1024))).toBeNull()
    // Many closed objects that are not JSON: each tried once, the reply cut at 64 KB.
    expect(firstJsonObject('{a}'.repeat(400 * 1024))).toBeNull()
    expect(Date.now() - start).toBeLessThan(2000)
  })

  test('an unreadable answer is no answer', () => {
    expect(readFlipAnswer('I think left', {hasWords: false})).toEqual({
      answer: null,
      confidence: 0,
      relevance: null,
      reasons: [],
      report: false,
      reportConfidence: 0,
      quality: null,
      doubted: false,
    })
    expect(
      readFlipAnswer('{"answer": "both", "confidence": 3}', {hasWords: false})
    ).toMatchObject({answer: null, confidence: 1})
  })

  const reply = (reasons, extra = '') =>
    `{"answer":"left","confidence":0.3,"keywords":"not shown"${extra},"reasons":${JSON.stringify(
      reasons
    )}}`

  test('a report when one reason reaches its threshold, and only with keywords', () => {
    const sure = reply([
      {reason: 4, confidence: REPORT_THRESHOLDS[4]},
      {reason: 1, confidence: 0.5},
    ])
    expect(readFlipAnswer(sure, {hasWords: true})).toEqual({
      answer: 'left',
      confidence: 0.3,
      relevance: 'irrelevant',
      reasons: [
        {reason: 4, confidence: REPORT_THRESHOLDS[4]},
        {reason: 1, confidence: 0.5},
      ],
      report: true,
      reportConfidence: REPORT_THRESHOLDS[4],
      quality: null,
      doubted: true,
    })
    expect(readFlipAnswer(sure, {hasWords: false})).toMatchObject({
      reasons: [],
      report: false,
    })
    // Every reason below its threshold: the reasons kept, no report, the flip left unmarked.
    const unsure = reply([
      {reason: 4, confidence: REPORT_THRESHOLDS[4] - 0.01},
      {reason: 1, confidence: 0.6},
    ])
    expect(readFlipAnswer(unsure, {hasWords: true})).toMatchObject({
      reasons: [
        {reason: 4, confidence: REPORT_THRESHOLDS[4] - 0.01},
        {reason: 1, confidence: 0.6},
      ],
      report: false,
      relevance: null,
    })
    // Sure of the story, not of a rule break: no report.
    const storySure =
      '{"answer":"left","confidence":0.99,"keywords":"not shown","reasons":[]}'
    expect(readFlipAnswer(storySure, {hasWords: true}).report).toBe(false)
    // How good a flip it is (B-260): read with keywords only, kept within 0 to 1.
    const good =
      '{"answer":"left","confidence":0.9,"keywords":"shown","reasons":[],"quality":0.85}'
    expect(readFlipAnswer(good, {hasWords: true}).quality).toBe(0.85)
    expect(readFlipAnswer(good, {hasWords: false}).quality).toBeNull()
    expect(
      readFlipAnswer(good.replace('0.85', '7'), {hasWords: true}).quality
    ).toBe(1)
    // A rule break half suspected, even below its threshold: no quality, never the best flip.
    const doubtful =
      '{"answer":"left","confidence":0.9,"keywords":"shown","reasons":[{"reason":6,"confidence":0.85}],"quality":0.9}'
    expect(readFlipAnswer(doubtful, {hasWords: true})).toMatchObject({
      report: false,
      quality: null,
    })
    // The report's certainty: its surest reason among those reaching their threshold, not the surest overall.
    const mixed = reply([
      {reason: 5, confidence: 0.88},
      {reason: 1, confidence: 0.71},
    ])
    expect(readFlipAnswer(mixed, {hasWords: true})).toMatchObject({
      report: true,
      reportConfidence: 0.71,
    })
  })

  test('each reason is held against its own threshold', () => {
    const thresholds = {...REPORT_THRESHOLDS, 5: 0.5, 2: 0.95}
    const read = (reasons) =>
      readFlipAnswer(reply(reasons), {hasWords: true, thresholds}).report
    expect(read([{reason: 5, confidence: 0.5}])).toBe(true)
    expect(read([{reason: 2, confidence: 0.9}])).toBe(false)
    expect(read([{reason: 2, confidence: 0.95}])).toBe(true)
    // Left out: the defaults.
    expect(
      readFlipAnswer(reply([{reason: 2, confidence: REPORT_THRESHOLDS[2]}]), {
        hasWords: true,
      }).report
    ).toBe(true)
  })

  test('unknown reasons are dropped, a reason given twice kept once', () => {
    const answer = readFlipAnswer(
      reply([
        {reason: 0, confidence: 1},
        {reason: 10, confidence: 1},
        {reason: '3', confidence: 2},
        {reason: 3, confidence: 0.2},
        {reason: 7.5, confidence: 1},
        'x',
        null,
      ]),
      {hasWords: true}
    )
    expect(answer.reasons).toEqual([{reason: 3, confidence: 1}])
    expect(answer.report).toBe(true)
    expect(readFlipAnswer(reply('3'), {hasWords: true}).reasons).toEqual([])
  })

  test('the question lists the nine reasons by number', () => {
    const {system} = flipQuestion(checkFlip(flip()))
    Object.entries(REPORT_REASONS).forEach(([n, text]) =>
      expect(system).toContain(`${n}. ${text}`)
    )
    expect(Object.keys(REPORT_THRESHOLDS)).toEqual(Object.keys(REPORT_REASONS))
  })

  test('keywords shown: the flip approved', () => {
    expect(
      readFlipAnswer(
        '{"answer":"right","confidence":0.7,"keywords":"shown","reasons":[]}',
        {hasWords: true}
      )
    ).toMatchObject({answer: 'right', relevance: 'relevant', report: false})
  })
})
