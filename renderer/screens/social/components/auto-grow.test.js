import {grownHeight} from './auto-grow'

describe('grownHeight', () => {
  it('keeps the box at its smallest height for a short text', () => {
    expect(grownHeight(40, 240, 600)).toBe(240)
  })

  it('follows the text between the two bounds', () => {
    expect(grownHeight(410, 240, 600)).toBe(410)
  })

  it('stops at the largest height, the text then scrolls', () => {
    expect(grownHeight(2000, 240, 600)).toBe(600)
  })
})
