import {defaultSide, imageSides, scaledSize} from './image'

describe('image sizes', () => {
  it('offers the sizes the image can fill, and its own when it is smaller', () => {
    expect(imageSides(4000)).toEqual([320, 480, 720, 1080])
    expect(imageSides(720)).toEqual([320, 480, 720])
    expect(imageSides(200)).toEqual([200])
  })

  it('starts at 480 when offered, else at the largest', () => {
    expect(defaultSide([320, 480, 720])).toBe(480)
    expect(defaultSide([320])).toBe(320)
    expect(defaultSide([200])).toBe(200)
  })

  it('scales the longer side and never enlarges', () => {
    expect(scaledSize(4000, 3000, 480)).toEqual([480, 360])
    expect(scaledSize(3000, 4000, 480)).toEqual([360, 480])
    expect(scaledSize(200, 100, 480)).toEqual([200, 100])
    expect(scaledSize(5000, 1, 320)).toEqual([320, 1])
  })
})
