const {http: httpFollow, https: httpsFollow} = require('follow-redirects')

// Node's Brotli decoder writes out of bounds on a crafted input (CVE-2026-111497, fixed in Node 24.22.1); the app's
// Electron runs an earlier Node. Until it runs one with the fix, the main process never decodes Brotli: its requests
// ask for gzip or deflate only, and a reply sent as Brotli anyway is refused before axios would decode it.

/** What the requests accept. */
const ACCEPT_ENCODING = 'gzip, deflate'

/** Whether a Content-Encoding header names Brotli (alone or in a list). */
function isBrotli(contentEncoding) {
  return String(contentEncoding || '')
    .split(',')
    .some((coding) => coding.trim().toLowerCase() === 'br')
}

/**
 * An axios transport: axios's own (follow-redirects, by the URL's protocol) that refuses a Brotli reply: axios never
 * gets it (no decoder, no stream), the request fails instead, before axios resolves anything.
 */
const brotliRefusingTransport = {
  request(options, callback) {
    const transport = options.protocol === 'https:' ? httpsFollow : httpFollow
    const req = transport.request(options, (res) => {
      if (!isBrotli(res.headers['content-encoding'])) {
        callback(res)
        return
      }
      res.destroy()
      req.destroy(
        new Error('the server sent a Brotli-compressed reply: refused')
      )
    })
    return req
  },
}

/** Makes every request of `axios` (the module or an instance) refuse Brotli. */
function refuseBrotli(axios) {
  axios.defaults.transport = brotliRefusingTransport
  axios.defaults.headers.common['Accept-Encoding'] = ACCEPT_ENCODING
}

module.exports = {ACCEPT_ENCODING, isBrotli, refuseBrotli}
