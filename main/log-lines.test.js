const {createLineSplitter} = require('./log-lines')

describe('the node output split into lines', () => {
  it('gives the whole lines of a chunk', () => {
    const lines = createLineSplitter()
    expect(lines.push(Buffer.from('one\ntwo\n\nthree\n'))).toEqual([
      'one',
      'two',
      'three',
    ])
  })

  it('keeps a line cut between two chunks whole', () => {
    const lines = createLineSplitter()
    expect(
      lines.push(Buffer.from('INFO first\nINFO IPFS repository conv'))
    ).toEqual(['INFO first'])
    expect(lines.push(Buffer.from('ersion ended converted=true\n'))).toEqual([
      'INFO IPFS repository conversion ended converted=true',
    ])
  })

  it('keeps a character cut between two chunks whole', () => {
    const lines = createLineSplitter()
    const text = Buffer.from('nœud\n')
    expect(lines.push(text.subarray(0, 2))).toEqual([])
    expect(lines.push(text.subarray(2))).toEqual(['nœud'])
  })

  it('drops the carriage return of Windows line ends', () => {
    expect(createLineSplitter().push(Buffer.from('one\r\ntwo\r\n'))).toEqual([
      'one',
      'two',
    ])
  })
})
