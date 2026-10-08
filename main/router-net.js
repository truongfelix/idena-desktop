const dgram = require('dgram')
const http = require('http')
const os = require('os')
const {
  MAX_STANDARD_LEASE_SECONDS,
  SSDP_SEARCH_TARGETS,
  UPNP_CONFLICT,
  UPNP_NO_SUCH_ENTRY,
  UPNP_ONLY_PERMANENT_LEASES,
  addPortMappingArgs,
  isLocalNetworkHost,
  parseGateway,
  parseSoap,
  parseSsdp,
  portArgs,
  portMapping,
  soapEnvelope,
  ssdpSearch,
} = require('./router-port')

// Talks to the router of the network this computer is on (main/router-port.js): finds its port forwarding
// service by SSDP, then sends it SOAP requests. Only addresses of the home network are contacted.

const SSDP_GROUP = '239.255.255.250'
const SSDP_PORT = 1900
const TIMEOUT_MS = 5000
const SEARCH_MS = 3000
const MAX_RESPONSE = 256 * 1024

/**
 * How long the app listens for a router's own announcements when none answers a search: UPnP has a device
 * announce itself again within half its announcements' lifetime (the Livebox: max-age 1800 s, so 15 min).
 */
const LISTEN_MS = 16 * 60 * 1000

/** A UPnP error answered by the router, or an answer that is not one. */
class RouterError extends Error {
  constructor(answer) {
    super(
      answer.errorCode === -1
        ? `the router answered ${answer.errorText}`
        : `the router refused (${answer.errorCode} ${
            answer.errorText || ''
          })`.replace(' )', ')')
    )
    this.answer = answer
  }
}

/** One HTTP request to the home network: {status, body, localAddress} (this computer's address on that connection). */
function httpRequest(url, {method = 'GET', headers = {}, body, timeoutMs}) {
  return new Promise((resolve, reject) => {
    const content = body == null ? null : Buffer.from(body, 'utf8')
    const req = http.request(url, {
      method,
      agent: false,
      headers: {
        ...headers,
        Connection: 'close',
        ...(content ? {'Content-Length': content.length} : {}),
      },
    })
    const timer = setTimeout(
      () => req.destroy(new Error('the router did not answer in time')),
      timeoutMs
    )
    req.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    req.on('response', (res) => {
      const localAddress = String(res.socket?.localAddress || '').replace(
        /^::ffff:/,
        ''
      )
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_RESPONSE) req.destroy(new Error('answer too long'))
        else chunks.push(chunk)
      })
      res.on('end', () => {
        clearTimeout(timer)
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          localAddress,
        })
      })
    })
    req.end(content || undefined)
  })
}

/** This computer's IPv4 addresses on home networks, one per interface. */
function homeAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (it) =>
        it &&
        (it.family === 'IPv4' || it.family === 4) &&
        !it.internal &&
        isLocalNetworkHost(it.address)
    )
    .map((it) => it.address)
}

/**
 * The router functions over `request` (an HTTP request, as httpRequest) and `createSocket` (dgram's): tests give
 * their own.
 */
function createRouterNet({
  request = httpRequest,
  createSocket = dgram.createSocket,
  addresses = homeAddresses,
} = {}) {
  /** A request to `url`, refused unless it goes to the home network. */
  function ask(url, options) {
    let host
    try {
      host = new URL(url).hostname
    } catch {
      host = null
    }
    if (!isLocalNetworkHost(host)) {
      return Promise.reject(new Error(`not on the home network: ${url}`))
    }
    return request(url, {timeoutMs: TIMEOUT_MS, ...options})
  }

  /** The forwarding service in the description at `location`, or null. */
  async function describe(location, timeoutMs = TIMEOUT_MS) {
    const response = await ask(location, {timeoutMs})
    return response.status === 200
      ? parseGateway(location, response.body)
      : null
  }

  /** The router at `location` if it is `udn` (this computer is on its network), else null. */
  async function gatewayAt(location, udn) {
    try {
      const gateway = await describe(location, 2000)
      return gateway?.udn === udn ? gateway : null
    } catch {
      return null
    }
  }

  /** The first of the routers found before (`known`) that answers here, or null. */
  async function knownHere(known) {
    for (const gateway of known) {
      // eslint-disable-next-line no-await-in-loop
      const here = gateway && (await gatewayAt(gateway.location, gateway.udn))
      if (here) return here
    }
    return null
  }

  /**
   * Reads SSDP datagrams on `sockets` until `ms` passed or one names a router (`accept` picks the datagrams
   * that count): its gateway, or null.
   */
  function firstGateway(sockets, ms, accept) {
    return new Promise((resolve) => {
      const tried = new Set()
      let done = false
      let timer = null
      const finish = (gateway) => {
        if (done) return
        done = true
        clearTimeout(timer)
        for (const socket of sockets) {
          try {
            socket.close()
          } catch {
            // already closed
          }
        }
        resolve(gateway)
      }
      timer = setTimeout(() => finish(null), ms)
      for (const socket of sockets) {
        socket.on('error', () => {})
        socket.on('message', (data) => {
          const message = parseSsdp(data.toString('latin1'))
          if (!message || !accept(message) || tried.has(message.location))
            return
          tried.add(message.location)
          // A router announces each of its devices and services: one description holds them all.
          describe(message.location)
            .then((gateway) => gateway && finish(gateway))
            .catch(() => {})
        })
      }
    })
  }

  function bound(socket, port, address) {
    return new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.bind({port, address, exclusive: false}, () => {
        socket.removeListener('error', reject)
        resolve(socket)
      })
    })
  }

  /** Sends the searches on each home network interface; the gateway that answers first, or null. */
  async function search() {
    const sockets = []
    for (const address of addresses()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const socket = await bound(createSocket({type: 'udp4'}), 0, address)
        socket.setMulticastInterface(address)
        sockets.push(socket)
      } catch {
        // this interface cannot send
      }
    }
    if (sockets.length === 0) return null
    const answer = firstGateway(sockets, SEARCH_MS, (it) => !it.notify)
    for (const socket of sockets) {
      for (const target of SSDP_SEARCH_TARGETS) {
        socket.send(ssdpSearch(target), SSDP_PORT, SSDP_GROUP, () => {})
      }
    }
    return answer
  }

  /** Listens for routers' announcements for up to `ms`; the first gateway announced, or null. */
  async function listen(ms) {
    let socket
    try {
      socket = await bound(
        createSocket({type: 'udp4', reuseAddr: true}),
        SSDP_PORT
      )
    } catch {
      return null
    }
    let joined = 0
    for (const address of addresses()) {
      try {
        socket.addMembership(SSDP_GROUP, address)
        joined += 1
      } catch {
        // not on this interface
      }
    }
    if (joined === 0) {
      socket.close()
      return null
    }
    return firstGateway([socket], ms, (it) => it.notify && it.alive)
  }

  /**
   * Finds the router's forwarding service: first at the addresses of routers found before (`known`), then by a
   * search, then by listening to announcements for up to `listenMs` (some routers, like the Livebox, never
   * answer a search). Null when none was found.
   */
  async function find(known, listenMs = LISTEN_MS) {
    return (await knownHere(known)) || (await search()) || listen(listenMs)
  }

  /** Sends `action` to the router: {answer, pcIp} (this computer's address as the router sees it). */
  async function soap(gateway, action, args) {
    const response = await ask(gateway.controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${gateway.service}#${action}"`,
      },
      body: soapEnvelope(gateway.service, action, args),
    })
    return {
      answer: parseSoap(response.status, response.body),
      pcIp: response.localAddress,
    }
  }

  /** The router's forwarding of `port` and this computer's address: {mapping, pcIp}, the mapping null when none. */
  async function mapping(gateway, port) {
    const {answer, pcIp} = await soap(
      gateway,
      'GetSpecificPortMappingEntry',
      portArgs(port)
    )
    if (!answer.ok && answer.errorCode !== UPNP_NO_SUCH_ENTRY)
      throw new RouterError(answer)
    return {mapping: portMapping(answer), pcIp}
  }

  /** Removes the forwarding of `port`; none there is fine. */
  async function remove(gateway, port) {
    const {answer} = await soap(gateway, 'DeletePortMapping', portArgs(port))
    if (!answer.ok && answer.errorCode !== UPNP_NO_SUCH_ENTRY)
      throw new RouterError(answer)
  }

  /**
   * Forwards `port` to `client` for `leaseSeconds` (0 = no end), replacing a forwarding this computer has there
   * (`replace`): deleted first, since the measured router (Livebox) once left a forwarding replaced in place
   * unreachable. A router that refuses a long lease gets the standard longest; one that only keeps leases with
   * no end gets that, and the upkeep closes it at the user's end.
   */
  async function open(gateway, port, client, leaseSeconds, replace) {
    if (replace) await remove(gateway, port)
    const add = async (lease) =>
      (
        await soap(
          gateway,
          'AddPortMapping',
          addPortMappingArgs(port, client, lease)
        )
      ).answer
    let answer = await add(leaseSeconds)
    if (!answer.ok && answer.errorCode === UPNP_ONLY_PERMANENT_LEASES) {
      answer = await add(0)
    } else if (
      !answer.ok &&
      answer.errorCode !== UPNP_CONFLICT &&
      leaseSeconds > MAX_STANDARD_LEASE_SECONDS
    ) {
      answer = await add(MAX_STANDARD_LEASE_SECONDS)
    }
    if (!answer.ok) throw new RouterError(answer)
  }

  return {gatewayAt, knownHere, search, listen, find, mapping, remove, open}
}

module.exports = {LISTEN_MS, RouterError, createRouterNet, httpRequest}
