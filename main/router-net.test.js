const {EventEmitter} = require('events')
const http = require('http')
const {RouterError, createRouterNet, httpRequest} = require('./router-net')
const {PORT_MAPPING_DESCRIPTION} = require('./router-port')

const WANIP1 = 'urn:schemas-upnp-org:service:WANIPConnection:1'
const LOCATION = 'http://192.168.1.1:49152/rootDesc.xml'
const DESCRIPTION = `<root><device><friendlyName>Livebox</friendlyName><UDN>uuid:root-1</UDN><serviceList>
<service><serviceType>${WANIP1}</serviceType><controlURL>/ctl/IPConn</controlURL></service>
</serviceList></device></root>`
const GATEWAY = {
  name: 'Livebox',
  udn: 'uuid:root-1',
  location: LOCATION,
  controlUrl: 'http://192.168.1.1:49152/ctl/IPConn',
  service: WANIP1,
}

const upnpError = (code) => ({
  status: 500,
  body: `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>E${code}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
})

/** A router answering on 192.168.1.1: its description, and SOAP actions through `onAction(action, args)`. */
function routerAnswering(onAction) {
  const calls = []
  const request = jest.fn(async (url, {method = 'GET', headers, body}) => {
    if (method === 'GET') {
      calls.push(['GET', url])
      return url === LOCATION
        ? {status: 200, body: DESCRIPTION, localAddress: '192.168.1.20'}
        : {status: 404, body: '', localAddress: '192.168.1.20'}
    }
    const action = /#(\w+)"$/.exec(headers.SOAPAction)[1]
    const args = Object.fromEntries(
      [...body.matchAll(/<(New\w+)>([^<]*)<\/\1>/g)].map((m) => [m[1], m[2]])
    )
    calls.push([action, args])
    return {
      status: 200,
      body: '',
      localAddress: '192.168.1.20',
      ...onAction(action, args),
    }
  })
  return {request, calls}
}

describe('router requests', () => {
  it('never contacts an address outside the home network', async () => {
    const {request} = routerAnswering(() => ({}))
    const net = createRouterNet({request})
    await expect(
      net.mapping({...GATEWAY, controlUrl: 'http://203.0.113.5/ctl'}, 50506)
    ).rejects.toThrow('not on the home network')
    await expect(
      net.mapping({...GATEWAY, controlUrl: 'http://127.0.0.1:9119/'}, 50506)
    ).rejects.toThrow('not on the home network')
    expect(
      await net.gatewayAt('http://203.0.113.5/d.xml', 'uuid:root-1')
    ).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it("reads the forwarding and this computer's address", async () => {
    const {request} = routerAnswering(() => ({
      body: `<NewInternalClient>192.168.1.20</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>${PORT_MAPPING_DESCRIPTION}</NewPortMappingDescription><NewLeaseDuration>600</NewLeaseDuration>`,
    }))
    const net = createRouterNet({request})
    expect(await net.mapping(GATEWAY, 50506)).toEqual({
      mapping: {
        client: '192.168.1.20',
        description: PORT_MAPPING_DESCRIPTION,
        enabled: true,
        leaseSeconds: 600,
      },
      pcIp: '192.168.1.20',
    })
  })

  it('reads no forwarding as none, and throws on another error', async () => {
    const none = createRouterNet({
      request: routerAnswering(() => upnpError(714)).request,
    })
    expect(await none.mapping(GATEWAY, 50506)).toEqual({
      mapping: null,
      pcIp: '192.168.1.20',
    })
    const broken = createRouterNet({
      request: routerAnswering(() => ({status: 501, body: 'nope'})).request,
    })
    await expect(broken.mapping(GATEWAY, 50506)).rejects.toThrow(
      'the router answered HTTP 501'
    )
  })

  it('deletes before adding when it replaces its own forwarding', async () => {
    const {request, calls} = routerAnswering(() => ({}))
    await createRouterNet({request}).open(
      GATEWAY,
      50506,
      '192.168.1.20',
      3600,
      true
    )
    expect(calls.map(([action]) => action)).toEqual([
      'DeletePortMapping',
      'AddPortMapping',
    ])
    expect(calls[1][1]).toMatchObject({
      NewExternalPort: '50506',
      NewInternalPort: '50506',
      NewInternalClient: '192.168.1.20',
      NewLeaseDuration: '3600',
    })
  })

  it('falls back to a lease with no end, or to the standard longest', async () => {
    const permanent = routerAnswering((action, args) =>
      args.NewLeaseDuration === '0' ? {} : upnpError(725)
    )
    await createRouterNet({request: permanent.request}).open(
      GATEWAY,
      50506,
      '192.168.1.20',
      3600,
      false
    )
    expect(permanent.calls.map(([, args]) => args.NewLeaseDuration)).toEqual([
      '3600',
      '0',
    ])

    const capped = routerAnswering((action, args) =>
      Number(args.NewLeaseDuration) > 604800 ? upnpError(402) : {}
    )
    await createRouterNet({request: capped.request}).open(
      GATEWAY,
      50506,
      '192.168.1.20',
      30 * 24 * 3600,
      false
    )
    expect(capped.calls.map(([, args]) => args.NewLeaseDuration)).toEqual([
      '2592000',
      '604800',
    ])
  })

  it('stops at a port another device holds', async () => {
    const taken = routerAnswering(() => upnpError(718))
    const error = await createRouterNet({request: taken.request})
      .open(GATEWAY, 50506, '192.168.1.20', 30 * 24 * 3600, false)
      .catch((e) => e)
    expect(error).toBeInstanceOf(RouterError)
    expect(error.message).toBe('the router refused (718 E718)')
    expect(taken.calls).toHaveLength(1)
  })

  it('finds a router known before at its address, only if it is the same one', async () => {
    const {request} = routerAnswering(() => ({}))
    const net = createRouterNet({request})
    expect(
      await net.knownHere([null, {...GATEWAY, udn: 'uuid:other'}])
    ).toBeNull()
    expect(
      await net.knownHere([{...GATEWAY, udn: 'uuid:other'}, GATEWAY])
    ).toEqual(GATEWAY)
  })
})

/** UDP sockets that record what the app does and deliver `datagrams` once the app is ready. */
function recordingSockets(onReady) {
  const sockets = []
  const createSocket = jest.fn(() => {
    const socket = new EventEmitter()
    socket.sent = []
    socket.memberships = []
    socket.bind = jest.fn((options, callback) => {
      socket.port = options.port
      setImmediate(callback)
    })
    socket.setMulticastInterface = jest.fn()
    socket.addMembership = jest.fn((group, address) => {
      socket.memberships.push([group, address])
      if (socket.memberships.length === 1) setImmediate(() => onReady(socket))
    })
    socket.send = jest.fn((message, port, host) => {
      socket.sent.push([String(message), port, host])
      if (socket.sent.length === 1) setImmediate(() => onReady(socket))
    })
    socket.close = jest.fn()
    sockets.push(socket)
    return socket
  })
  return {createSocket, sockets}
}

const datagram = (text) => Buffer.from(text, 'latin1')

describe('router search', () => {
  it('searches on each home interface and takes the first answer', async () => {
    const {request} = routerAnswering(() => ({}))
    const {createSocket, sockets} = recordingSockets((socket) => {
      socket.emit(
        'message',
        datagram(
          `HTTP/1.1 200 OK\r\nST: ${WANIP1}\r\nLOCATION: http://203.0.113.5/x.xml\r\n\r\n`
        )
      )
      socket.emit(
        'message',
        datagram(
          `HTTP/1.1 200 OK\r\nST: ${WANIP1}\r\nLOCATION: ${LOCATION}\r\n\r\n`
        )
      )
    })
    const net = createRouterNet({
      request,
      createSocket,
      addresses: () => ['192.168.1.20', '10.0.0.5'],
    })
    expect(await net.search()).toEqual(GATEWAY)
    expect(sockets).toHaveLength(2)
    expect(sockets[0].bind).toHaveBeenCalledWith(
      expect.objectContaining({port: 0, address: '192.168.1.20'}),
      expect.any(Function)
    )
    expect(sockets[0].setMulticastInterface).toHaveBeenCalledWith(
      '192.168.1.20'
    )
    expect(sockets[0].sent).toHaveLength(6)
    expect(sockets[0].sent[0][0]).toMatch(/^M-SEARCH \* HTTP\/1.1\r\n/)
    expect(sockets[0].sent[5][0]).toMatch(/\r\nST: upnp:rootdevice\r\n/)
    expect(sockets[0].sent[0].slice(1)).toEqual([1900, '239.255.255.250'])
    expect(
      sockets.every((socket) => socket.close.mock.calls.length === 1)
    ).toBe(true)
    // The address outside the home network was never asked.
    expect(request.mock.calls.map(([url]) => url)).toEqual([LOCATION])
  })

  it('names the router at the default gateway when it offers no port opening', async () => {
    const speedport = 'http://192.168.2.1:34199/rootDesc.xml'
    const tv = 'http://192.168.2.50:8080/tv.xml'
    const request = jest.fn(async (url) => ({
      status: 200,
      body:
        url === speedport
          ? '<root><device><friendlyName>Speedport Smart 4 Typ B</friendlyName><UDN>uuid:sp</UDN></device></root>'
          : '<root><device><friendlyName>Living room TV</friendlyName></device></root>',
      localAddress: '192.168.2.97',
    }))
    const rootDevice = (location) =>
      datagram(
        `HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nLOCATION: ${location}\r\n\r\n`
      )
    // A repeater answers the gateway search: read for a forwarding service, never named.
    const repeater = 'http://192.168.2.60/igd.xml'
    const {createSocket, sockets} = recordingSockets((socket) => {
      socket.emit(
        'message',
        datagram(
          `HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: ${repeater}\r\n\r\n`
        )
      )
      socket.emit('message', rootDevice(tv))
      socket.emit('message', rootDevice(speedport))
    })
    const onHeard = jest.fn()
    const net = createRouterNet({
      request,
      createSocket,
      addresses: () => ['192.168.2.97'],
      routers: async () => ['192.168.2.1'],
      searchMs: 20,
    })
    expect(await net.search(onHeard)).toBeNull()
    expect(onHeard.mock.calls).toEqual([['Speedport Smart 4 Typ B']])
    // Each search went out twice: UDP loses some.
    expect(sockets[0].sent).toHaveLength(12)
    expect(sockets[0].sent[11][0]).toMatch(/\r\nST: upnp:rootdevice\r\n/)
    // The other device's root was not read.
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      repeater,
      speedport,
    ])

    // With no default gateway known, no device is named.
    const unnamed = jest.fn()
    expect(
      await createRouterNet({
        request,
        createSocket,
        addresses: () => ['192.168.2.97'],
        routers: async () => {
          throw new Error('no table')
        },
        searchMs: 20,
      }).search(unnamed)
    ).toBeNull()
    expect(unnamed).not.toHaveBeenCalled()
  })

  it('takes a gateway over the name, also one whose description comes at the end', async () => {
    const speedport = 'http://192.168.1.1:34199/rootDesc.xml'
    const request = jest.fn(
      (url) =>
        new Promise((resolve) => {
          const answer =
            url === LOCATION
              ? {status: 200, body: DESCRIPTION}
              : {
                  status: 200,
                  body: '<root><device><friendlyName>Box</friendlyName></device></root>',
                }
          // The gateway's description comes after the search's end.
          setTimeout(
            () => resolve({...answer, localAddress: '192.168.1.20'}),
            url === LOCATION ? 60 : 0
          )
        })
    )
    const {createSocket, sockets} = recordingSockets((socket) => {
      socket.emit(
        'message',
        datagram(
          `HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nLOCATION: ${speedport}\r\n\r\n`
        )
      )
      socket.emit(
        'message',
        datagram(
          `HTTP/1.1 200 OK\r\nST: ${WANIP1}\r\nLOCATION: ${LOCATION}\r\n\r\n`
        )
      )
    })
    const onHeard = jest.fn()
    const net = createRouterNet({
      request,
      createSocket,
      addresses: () => ['192.168.1.20'],
      routers: async () => ['192.168.1.1'],
      searchMs: 20,
    })
    expect(await net.search(onHeard)).toEqual(GATEWAY)
    expect(onHeard).not.toHaveBeenCalled()
    expect(sockets[0].close).toHaveBeenCalledTimes(1)
  })

  it('names the router before it listens for announcements', async () => {
    const order = []
    const request = jest.fn(async () => ({
      status: 200,
      body: '<root><device><friendlyName>Speedport</friendlyName></device></root>',
      localAddress: '192.168.2.97',
    }))
    const {createSocket} = recordingSockets((socket) => {
      if (socket.port === 1900) return
      socket.emit(
        'message',
        datagram(
          'HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nLOCATION: http://192.168.2.1/d.xml\r\n\r\n'
        )
      )
    })
    const net = createRouterNet({
      request,
      createSocket: jest.fn((options) => {
        order.push(options.reuseAddr ? 'listen' : 'search')
        return createSocket(options)
      }),
      addresses: () => ['192.168.2.97'],
      routers: async () => ['192.168.2.1'],
      searchMs: 20,
    })
    expect(
      await net.find([], {
        listenMs: 20,
        onHeard: (name) => order.push(`heard ${name}`),
      })
    ).toBeNull()
    expect(order).toEqual(['search', 'heard Speedport', 'listen'])
  })

  it('listens for announcements, skipping the ones that leave', async () => {
    const {request} = routerAnswering(() => ({}))
    const {createSocket, sockets} = recordingSockets((socket) => {
      socket.emit(
        'message',
        datagram(
          `NOTIFY * HTTP/1.1\r\nLOCATION: ${LOCATION}\r\nNT: ${WANIP1}\r\nNTS: ssdp:byebye\r\n\r\n`
        )
      )
      setImmediate(() =>
        socket.emit(
          'message',
          datagram(
            `NOTIFY * HTTP/1.1\r\nLOCATION: ${LOCATION}\r\nNT: ${WANIP1}\r\nNTS: ssdp:alive\r\n\r\n`
          )
        )
      )
    })
    const net = createRouterNet({
      request,
      createSocket,
      addresses: () => ['192.168.1.20'],
    })
    expect(await net.listen(5000)).toEqual(GATEWAY)
    expect(sockets[0].port).toBe(1900)
    expect(sockets[0].memberships).toEqual([
      ['239.255.255.250', '192.168.1.20'],
    ])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('gives up when no router answers in time', async () => {
    const {createSocket} = recordingSockets(() => {})
    const net = createRouterNet({
      request: jest.fn(),
      createSocket,
      addresses: () => ['192.168.1.20'],
    })
    expect(await net.listen(20)).toBeNull()
    expect(
      await createRouterNet({createSocket, addresses: () => []}).search()
    ).toBeNull()
  })
})

describe('httpRequest', () => {
  let server
  let base

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') return
      if (req.url === '/big') {
        res.end('x'.repeat(300 * 1024))
        return
      }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        res.writeHead(200, {'Content-Type': 'text/xml'})
        res.end(`${req.method} ${req.headers.soapaction} ${body}`)
      })
    })
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    base = `http://127.0.0.1:${server.address().port}`
  })

  afterAll(
    () =>
      new Promise((resolve) => {
        server.close(resolve)
      })
  )

  it("returns the answer and this computer's address on the connection", async () => {
    expect(
      await httpRequest(`${base}/ctl`, {
        method: 'POST',
        headers: {SOAPAction: '"x#y"'},
        body: '<a/>',
        timeoutMs: 2000,
      })
    ).toEqual({status: 200, body: 'POST "x#y" <a/>', localAddress: '127.0.0.1'})
  })

  it('stops a long answer and a silent server', async () => {
    await expect(httpRequest(`${base}/big`, {timeoutMs: 2000})).rejects.toThrow(
      'answer too long'
    )
    await expect(httpRequest(`${base}/slow`, {timeoutMs: 100})).rejects.toThrow(
      'the router did not answer in time'
    )
  })
})
