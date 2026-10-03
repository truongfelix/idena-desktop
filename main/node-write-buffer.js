// The chain database write buffer sizes the app offers, in MiB (idena-go --dbwritebuffer; 4 is idena-go's
// default). A bigger buffer makes the node write much less to disk for more memory.
const DB_WRITE_BUFFER_SIZES = [4, 16, 32, 64]

/**
 * The node arguments for a write buffer of `mib`: none when the size is not one offered, or when the node
 * binary does not know the flag (its `--help` text): an official 1.1.2 binary would not start with it.
 */
function dbWriteBufferArgs(mib, helpText) {
  if (
    !DB_WRITE_BUFFER_SIZES.includes(mib) ||
    !String(helpText || '').includes('--dbwritebuffer')
  ) {
    return []
  }
  return ['--dbwritebuffer', String(mib)]
}

module.exports = {DB_WRITE_BUFFER_SIZES, dbWriteBufferArgs}
