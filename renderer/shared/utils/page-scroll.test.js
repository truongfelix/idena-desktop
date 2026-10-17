import fs from 'fs'
import path from 'path'
import {scrollTargetOf} from './page-scroll'

describe("a page's scroll after a move in the history", () => {
  const saved = new Map([['/social', 700]])

  it('goes back to where the list was left, after a back or forward', () => {
    expect(scrollTargetOf('pop', '/social', saved)).toBe(700)
  })

  it('opens a new view at its top', () => {
    expect(scrollTargetOf('push', '/social?post=2', saved)).toBe(0)
    expect(scrollTargetOf('push', '/social', saved)).toBe(0)
  })

  it('stays where it is after a replace, or a pop to a place never left', () => {
    expect(scrollTargetOf('replace', '/social', saved)).toBeNull()
    expect(scrollTargetOf('pop', '/social?post=9', saved)).toBeNull()
  })
})

describe('the Social page', () => {
  // It scrolled to its top on every view change, the way back included (B-105): the Page keeps the scroll now.
  it('leaves its scroll to the Page', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'social.js'),
      'utf8'
    )
    expect(source).not.toMatch(/scrollTo\(0, ?0\)/)
  })
})
