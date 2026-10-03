import fs from 'fs'
import path from 'path'
import {dataUrlToArrayBuffer} from './image-canvas'

const bytesOf = (buffer) => [...new Uint8Array(buffer)]

describe('data URL bytes', () => {
  it('decodes base64, as canvas.toDataURL gives', () => {
    const jpegStart = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
    const url = `data:image/jpeg;base64,${Buffer.from(jpegStart).toString(
      'base64'
    )}`
    expect(bytesOf(dataUrlToArrayBuffer(url))).toEqual(jpegStart)
  })

  it('decodes a percent-encoded data URL', () => {
    expect(bytesOf(dataUrlToArrayBuffer('data:text/plain,a%20b'))).toEqual([
      0x61, 0x20, 0x62,
    ])
  })

  it('refuses anything else', () => {
    expect(() => dataUrlToArrayBuffer('https://example.com/a.png')).toThrow(
      'Not a data URL'
    )
  })

  it('is not fetched: the CSP blocks fetch() of data: URLs', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'image-canvas.js'),
      'utf8'
    )
    expect(source).not.toMatch(/fetch\(/)
  })
})
