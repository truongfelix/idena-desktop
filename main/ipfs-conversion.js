// The node's one-time conversion of an IPFS repository the official app left in Badger (B-162; idena-go
// ipfs/badger_convert.go): read from its log lines, for the sync screen. During it the node only answers that it
// syncs at block 0, which reads as a stuck sync for up to an hour on a hard disk.

const START = 'Start converting the IPFS repository'
const PROGRESS = 'Converting the IPFS repository from Badger'
const END = 'IPFS repository conversion ended'

// idena-go colours its log fields, also when written to a pipe.
// eslint-disable-next-line no-control-regex
const COLOURS = /\x1b\[[0-9;]*m/g

function field(line, name) {
  const match = line.match(new RegExp(`\\b${name}=(\\d+)`))
  return match ? Number(match[1]) : null
}

/**
 * The conversion after these log lines: null when none runs, else `{percent, minutesLeft}` (each null until the
 * node logged it). `previous`: the state before them.
 */
function readIpfsConversion(previous, lines) {
  let state = previous
  for (const raw of lines) {
    const line = String(raw).replace(COLOURS, '')
    if (line.includes(END)) state = null
    else if (line.includes(START)) state = {percent: null, minutesLeft: null}
    else if (line.includes(PROGRESS) && state)
      state = {
        percent: field(line, 'percent') ?? state.percent,
        minutesLeft: field(line, 'minutesLeft') ?? state.minutesLeft,
      }
  }
  return state
}

module.exports = {readIpfsConversion}
