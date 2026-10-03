const {
  DB_WRITE_BUFFER_SIZES,
  dbWriteBufferArgs,
  nodeSupportsWriteBuffer,
} = require('./node-write-buffer')

const ourHelp =
  '   --dbwritebuffer value  Chain database write buffer in MiB (default 4)'
const officialHelp = '   --apikey value  API key for an access'

describe('chain database write buffer', () => {
  it('offers the four sizes', () => {
    expect(DB_WRITE_BUFFER_SIZES).toEqual([4, 16, 32, 64])
  })

  it('passes an offered size to a node that knows the flag', () => {
    expect(dbWriteBufferArgs(32, ourHelp)).toEqual(['--dbwritebuffer', '32'])
    expect(dbWriteBufferArgs(4, ourHelp)).toEqual(['--dbwritebuffer', '4'])
  })

  it('passes nothing to a node without the flag', () => {
    expect(dbWriteBufferArgs(32, officialHelp)).toEqual([])
    expect(dbWriteBufferArgs(32, '')).toEqual([])
    expect(dbWriteBufferArgs(32, undefined)).toEqual([])
  })

  it('passes nothing for a size not offered', () => {
    expect(dbWriteBufferArgs(8, ourHelp)).toEqual([])
    expect(dbWriteBufferArgs('32', ourHelp)).toEqual([])
    expect(dbWriteBufferArgs(undefined, ourHelp)).toEqual([])
    expect(dbWriteBufferArgs(1024, ourHelp)).toEqual([])
  })

  it('tells whether a node binary has the flag', () => {
    expect(nodeSupportsWriteBuffer(ourHelp)).toBe(true)
    expect(nodeSupportsWriteBuffer(officialHelp)).toBe(false)
    expect(nodeSupportsWriteBuffer(undefined)).toBe(false)
  })
})
