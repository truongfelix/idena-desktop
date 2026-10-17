import fs from 'fs'
import path from 'path'
import {keep, keptValue} from './kept-state'

describe('the kept view state', () => {
  it('gives the kept value, or the initial one for a new key', () => {
    expect(keptValue('test.query', '')).toBe('')
    keep('test.query', 'pill')
    expect(keptValue('test.query', '')).toBe('pill')
    expect(keptValue('test.other', 30)).toBe(30)
  })

  // The feed's search and a profile's list lived in the view, rebuilt on the way back (B-106).
  it("holds the feed's search and a profile's list", () => {
    const read = (file) =>
      fs.readFileSync(path.join(__dirname, 'views', file), 'utf8')
    expect(read('home.js')).toMatch(/useKeptState\('home\.query'/)
    expect(read('profile.js')).toMatch(/useKeptState\(`profile\.tab:/)
  })
})
