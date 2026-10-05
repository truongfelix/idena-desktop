// The database write buffer sizes the app offers, in MiB, for the chain database (idena-go --dbwritebuffer)
// and the IPFS datastore (--ipfswritebuffer); 4 is idena-go's default for both. A bigger buffer makes the
// node write much less to disk for more memory.
const DB_WRITE_BUFFER_SIZES = [4, 16, 32, 64]
const IPFS_WRITE_BUFFER_SIZES = DB_WRITE_BUFFER_SIZES

/**
 * The node arguments for a chain database write buffer of `mib`: none when the size is not one offered, or
 * when the node binary does not know the flag (its `--help` text): an official 1.1.2 binary would not start
 * with it.
 */
function dbWriteBufferArgs(mib, helpText) {
  if (
    !DB_WRITE_BUFFER_SIZES.includes(mib) ||
    !nodeSupportsWriteBuffer(helpText)
  ) {
    return []
  }
  return ['--dbwritebuffer', String(mib)]
}

/** Whether a node binary has the flag, from its `--help` text. */
function nodeSupportsWriteBuffer(helpText) {
  return String(helpText || '').includes('--dbwritebuffer')
}

/** The node arguments for an IPFS datastore write buffer of `mib`, on the rules of `dbWriteBufferArgs`. */
function ipfsWriteBufferArgs(mib, helpText) {
  if (
    !IPFS_WRITE_BUFFER_SIZES.includes(mib) ||
    !nodeSupportsIpfsWriteBuffer(helpText)
  ) {
    return []
  }
  return ['--ipfswritebuffer', String(mib)]
}

/** Whether a node binary has the IPFS write buffer flag, from its `--help` text. */
function nodeSupportsIpfsWriteBuffer(helpText) {
  return String(helpText || '').includes('--ipfswritebuffer')
}

module.exports = {
  DB_WRITE_BUFFER_SIZES,
  IPFS_WRITE_BUFFER_SIZES,
  dbWriteBufferArgs,
  nodeSupportsWriteBuffer,
  ipfsWriteBufferArgs,
  nodeSupportsIpfsWriteBuffer,
}
