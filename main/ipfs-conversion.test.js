const {readIpfsConversion} = require('./ipfs-conversion')

// Lines as idena-go writes them, colours included (copied from a node's log, 2026-11-01).
const ESC = '\x1b'
const colour = (line) =>
  line
    .replace(/(\w+)=/g, `${ESC}[32m$1${ESC}[0m=`)
    .replace(/^INFO/, `${ESC}[32mINFO${ESC}[0m`)
const START = colour(
  'INFO [11-01|12:36:08.961] Start converting the IPFS repository     attempt=1 resumedAtKeys=0'
)
const FIRST = colour(
  'INFO [11-01|12:38:20.104] Converting the IPFS repository from Badger estimatedMiB=4110 keys=0 percent=0'
)
const PROGRESS = colour(
  'INFO [11-01|12:48:20.104] Converting the IPFS repository from Badger keys=2100000 percent=31 minutesLeft=42'
)
const NO_ETA = colour(
  'INFO [11-01|12:48:30.104] Converting the IPFS repository from Badger keys=2150000 percent=32'
)
const END = colour(
  'INFO [11-01|13:40:00.000] IPFS repository conversion ended         converted=true keys=15300000'
)

describe('the IPFS conversion read from the node log', () => {
  it('is none before its start line', () => {
    expect(readIpfsConversion(null, [PROGRESS])).toBeNull()
    expect(readIpfsConversion(null, ['INFO Ipfs initialized'])).toBeNull()
  })

  it('runs from its start line, without numbers yet', () => {
    expect(readIpfsConversion(null, [START])).toEqual({
      percent: null,
      minutesLeft: null,
    })
  })

  it('takes the percent and the minutes left of each progress line', () => {
    expect(readIpfsConversion(null, [START, FIRST])).toEqual({
      percent: 0,
      minutesLeft: null,
    })
    expect(readIpfsConversion(null, [START, FIRST, PROGRESS])).toEqual({
      percent: 31,
      minutesLeft: 42,
    })
  })

  it('keeps the minutes left a line leaves out', () => {
    const state = readIpfsConversion(null, [START, PROGRESS])
    expect(readIpfsConversion(state, [NO_ETA])).toEqual({
      percent: 32,
      minutesLeft: 42,
    })
  })

  it('ends with its end line', () => {
    const state = readIpfsConversion(null, [START, PROGRESS])
    expect(readIpfsConversion(state, [END])).toBeNull()
    expect(readIpfsConversion(null, [START, PROGRESS, END])).toBeNull()
  })

  it('reads a resumed conversion as a new one', () => {
    const state = readIpfsConversion(null, [START, PROGRESS])
    expect(readIpfsConversion(state, [START])).toEqual({
      percent: null,
      minutesLeft: null,
    })
  })
})
