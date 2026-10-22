const http = require('http')
const zlib = require('zlib')
const axios = require('axios')
const {ACCEPT_ENCODING, isBrotli, refuseBrotli} = require('./refuse-brotli')

const BODY = JSON.stringify({tag_name: 'v1.2.3'})

/** A local server: Brotli, gzip, a redirect to the gzip reply, and the Accept-Encoding it last got. */
function startServer() {
  const seen = {}
  const server = http.createServer((req, res) => {
    seen.acceptEncoding = req.headers['accept-encoding']
    if (req.url === '/br') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'br',
      })
      res.end(zlib.brotliCompressSync(BODY))
    } else if (req.url === '/gzip') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      })
      res.end(zlib.gzipSync(BODY))
    } else if (req.url === '/redirect-br') {
      res.writeHead(302, {location: '/br'})
      res.end()
    } else if (req.url === '/redirect') {
      res.writeHead(302, {location: '/gzip'})
      res.end()
    } else {
      res.writeHead(200, {'content-type': 'application/json'})
      res.end(BODY)
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({server, seen, url: `http://127.0.0.1:${server.address().port}`})
    )
  })
}

describe('requests without Brotli', () => {
  let env

  beforeEach(async () => {
    env = await startServer()
  })

  afterEach(async () => {
    env.server.closeAllConnections()
    await new Promise((resolve) => {
      env.server.close(resolve)
    })
  })

  it('tells Brotli in a Content-Encoding header, alone or in a list', () => {
    expect(isBrotli('br')).toBe(true)
    expect(isBrotli(' BR ')).toBe(true)
    expect(isBrotli('gzip, br')).toBe(true)
    expect(isBrotli('gzip')).toBe(false)
    expect(isBrotli('brotli')).toBe(false)
    expect(isBrotli(undefined)).toBe(false)
  })

  it('asks for gzip or deflate only, and still reads gzip, plain and redirected replies', async () => {
    const client = axios.create()
    refuseBrotli(client)
    expect((await client.get(`${env.url}/gzip`)).data).toEqual({
      tag_name: 'v1.2.3',
    })
    expect(env.seen.acceptEncoding).toBe(ACCEPT_ENCODING)
    expect((await client.get(`${env.url}/plain`)).data.tag_name).toBe('v1.2.3')
    expect((await client.get(`${env.url}/redirect`)).data.tag_name).toBe(
      'v1.2.3'
    )
  })

  it('refuses a Brotli reply without decoding it', async () => {
    const client = axios.create()
    refuseBrotli(client)
    await expect(client.get(`${env.url}/br`)).rejects.toThrow(
      'the server sent a Brotli-compressed reply: refused'
    )
    await expect(client.get(`${env.url}/redirect-br`)).rejects.toThrow(
      'the server sent a Brotli-compressed reply: refused'
    )
    // A download reads a stream: it fails too, before any stream is handed over.
    await expect(
      client.get(`${env.url}/br`, {responseType: 'stream'})
    ).rejects.toThrow('the server sent a Brotli-compressed reply: refused')
  })

  it('decodes Brotli without it: what it turns off', async () => {
    const client = axios.create()
    expect((await client.get(`${env.url}/br`)).data.tag_name).toBe('v1.2.3')
  })
})
