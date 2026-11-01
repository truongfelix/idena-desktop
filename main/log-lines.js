// The node's output arrives in chunks that can end in the middle of a line, or of a character: the watchdog's and
// the IPFS conversion's markers (main/node-watch.js, main/ipfs-conversion.js) are whole lines.
const {StringDecoder} = require('string_decoder')

/** Splits a stream's chunks into whole lines; the end of a chunk after its last line break waits for the next. */
function createLineSplitter() {
  const decoder = new StringDecoder('utf8')
  let rest = ''
  return {
    /** The lines (empty ones left out) the chunk completes. */
    push(chunk) {
      const lines = (rest + decoder.write(chunk)).split('\n')
      rest = lines.pop()
      return lines.map((line) => line.replace(/\r$/, '')).filter((line) => line)
    },
  }
}

module.exports = {createLineSplitter}
