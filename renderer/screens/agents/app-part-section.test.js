import {PART_AREAS, withPart} from './app-part-section'

const main = require('../../../main/agent/app-parts')
const {defaultParts} = require('../../../main/agent/app-texts')

// B-282: the app's part, unlocked per area.
describe("an agent's own parts", () => {
  const defaults = defaultParts()

  test('the areas are the main process’s', () => {
    expect(PART_AREAS).toEqual(Object.keys(main.AREAS))
  })

  test('a changed text is kept for its area alone; the default, an empty text or null takes it out', () => {
    const one = withPart(undefined, 'social', 'Mine', defaults)
    expect(one).toEqual({social: 'Mine'})
    const two = withPart(one, 'validation', 'Mine too', defaults)
    expect(two).toEqual({social: 'Mine', validation: 'Mine too'})
    expect(withPart(two, 'social', null, defaults)).toEqual({
      validation: 'Mine too',
    })
    expect(withPart(two, 'social', `${defaults.social}\n`, defaults)).toEqual({
      validation: 'Mine too',
    })
    expect(withPart(two, 'validation', '  ', defaults)).toEqual({
      social: 'Mine',
    })
    // The input is left as it was, and what is kept is what the main process keeps.
    expect(one).toEqual({social: 'Mine'})
    expect(main.normalizeParts(two, defaults)).toEqual(two)
  })
})
