const fs = require('fs')
const {
  cleanGateway,
  cleanOpening,
  inboundPeersSince,
  ipfsAddressPort,
  leaseSeconds,
  mappingOwner,
  upkeepAction,
} = require('./router-port')

// Runs the Router port row of the Advanced settings (main/router-port.js) in the main process: reads the
// forwarding of the node's port on a router found before, else looks for the router when the user asks (up to
// ~16 min; never by itself: on Windows, listening for the router can bring up a firewall prompt); opens or
// closes the forwarding at the user's request; and keeps the opening while the app runs (`upkeep`, every few
// minutes). Its file holds the opening the app made, the routers found before (to skip the search next time)
// and the last search.

/** The latest end the row accepts: "until the validation + 2 h" is at most an epoch away. */
const MAX_OPENING_MS = 60 * 24 * 60 * 60 * 1000

/** How often the upkeep runs while the app runs. */
const UPKEEP_INTERVAL_MS = 5 * 60 * 1000

/**
 * `file` gives the file's path; `net` talks to the router (main/router-net.js); `nodeRpc(method)` asks the
 * built-in node (throws when it does not answer); `configuredPort()` is the IPFS port the node was started
 * with; `nodeLogTail()` is the end of the node's log.
 */
function createRouterPortService({
  file,
  net,
  nodeRpc,
  configuredPort,
  nodeLogTail,
  logger,
  now = Date.now,
}) {
  let gateway = null
  let search = null
  // Why the router stopped answering, until the row tries again; why the user's last request failed.
  let failure = null
  let actionError = null
  let queue = Promise.resolve()

  function load() {
    let json = {}
    try {
      json = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}
    } catch {
      json = {}
    }
    return {
      opening: cleanOpening(json.opening),
      gateways: (Array.isArray(json.gateways) ? json.gateways : [])
        .map(cleanGateway)
        .filter(Boolean),
      lastSearchMs: Number.isFinite(json.lastSearchMs)
        ? json.lastSearchMs
        : null,
    }
  }

  function save(changes) {
    const path = file()
    const tmp = `${path}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({...load(), ...changes}), {
      mode: 0o600,
    })
    fs.renameSync(tmp, path)
  }

  /** Runs `task` after the router requests before it: the row and the upkeep never change the router at once. */
  function exclusive(task) {
    const run = queue.then(task, task)
    queue = run.catch(() => {})
    return run
  }

  /** The port the node listens on now, from its RPC; null when it does not answer. */
  async function livePort() {
    try {
      return ipfsAddressPort(await nodeRpc('net_ipfsAddress'))
    } catch {
      return null
    }
  }

  async function validationRuns() {
    try {
      const epoch = await nodeRpc('dna_epoch')
      return Boolean(epoch?.currentPeriod) && epoch.currentPeriod !== 'None'
    } catch {
      return false
    }
  }

  function inboundSince(opening) {
    try {
      return inboundPeersSince(nodeLogTail(), opening.changedAtMs, now())
    } catch {
      return null
    }
  }

  function startSearch() {
    if (search) return
    const startedMs = now()
    save({lastSearchMs: startedMs})
    const {opening, gateways} = load()
    const known = [opening?.gateway, ...gateways].filter(Boolean)
    search = {startedMs}
    net
      .find(known)
      .then((found) => {
        if (!found) return
        gateway = found
        failure = null
        save({
          gateways: [
            found,
            ...load().gateways.filter((it) => it.udn !== found.udn),
          ].slice(0, 8),
        })
      })
      .catch((error) => logger.warn('router search failed', String(error)))
      .finally(() => {
        search = null
      })
  }

  /** What the row shows for the router `found`: its forwarding of the opening's port, else of the node's. */
  async function read(found) {
    const {opening: saved} = load()
    const opening = saved?.gateway.udn === found.udn ? saved : null
    const port = opening?.port ?? (await livePort()) ?? configuredPort()
    if (!port) return {state: 'node-stopped'}
    try {
      const {mapping, pcIp} = await net.mapping(found, port)
      return {
        state: 'found',
        name: found.name,
        port,
        pcIp,
        mapping,
        owner: mappingOwner(mapping, pcIp, opening),
        opening: opening && {
          port: opening.port,
          client: opening.client,
          endMs: opening.endMs,
        },
        inbound: opening ? inboundSince(opening) : null,
        error: actionError,
      }
    } catch (error) {
      // The router stopped answering: maybe this computer moved to another network.
      gateway = null
      failure = error.message || String(error)
      return {state: 'failed', message: failure}
    }
  }

  /**
   * The row's state: 'found' (see read), 'searching' ({startedMs}), 'not-found', 'failed' ({message}),
   * 'node-stopped' (no port to read yet) or 'idle' (never looked for). A router that stopped answering stays
   * 'failed' until `retry` ("Try again").
   */
  async function status({retry = false} = {}) {
    if (search) return {state: 'searching', startedMs: search.startedMs}
    if (!gateway) {
      const {opening, gateways} = load()
      gateway = await net.knownHere([opening?.gateway, ...gateways])
    }
    if (gateway) return read(gateway)
    if (retry) failure = null
    if (failure) return {state: 'failed', message: failure}
    return load().lastSearchMs == null ? {state: 'idle'} : {state: 'not-found'}
  }

  /** "Look for the router", "Search again": looks for the router now. */
  function searchAgain() {
    failure = null
    gateway = null
    startSearch()
    return {state: 'searching', startedMs: search.startedMs}
  }

  /** Runs a request of the row on the router found, then reads it again, with the request's error if it failed. */
  function act(request) {
    return exclusive(async () => {
      const found = gateway
      if (!found) return status()
      try {
        await request(found)
        actionError = null
      } catch (error) {
        actionError = error.message || String(error)
        logger.warn('router port request failed', actionError)
      }
      return read(found)
    })
  }

  /** Opens the node's port for this computer until `endMs`, replacing a forwarding this computer has there. */
  function open({endMs}) {
    return act(async (found) => {
      const nowMs = now()
      if (!(endMs > nowMs + 60 * 1000 && endMs < nowMs + MAX_OPENING_MS)) {
        throw new Error('this end cannot be chosen')
      }
      const port = (await livePort()) ?? configuredPort()
      if (!port) throw new Error('start the node first')
      const {opening: before} = load()
      // The app's opening of a port the node left: closed first, it would stay open until its end.
      if (before?.gateway.udn === found.udn && before.port !== port) {
        const old = await net.mapping(found, before.port)
        if (
          ['pc', 'pc-before'].includes(
            mappingOwner(old.mapping, old.pcIp, before)
          )
        )
          await net.remove(found, before.port)
      }
      const {mapping, pcIp} = await net.mapping(found, port)
      const owner = mappingOwner(mapping, pcIp, before)
      if (owner === 'other') throw new Error('the port goes to another device')
      const opening = {
        gateway: found,
        port,
        client: pcIp,
        endMs,
        changedAtMs: nowMs,
        retried: false,
      }
      await net.open(
        found,
        port,
        pcIp,
        leaseSeconds(opening, nowMs),
        owner !== 'none'
      )
      save({opening})
      logger.info('router port opened', {
        port,
        until: new Date(endMs).toISOString(),
      })
    })
  }

  /** Closes the node's port at once. */
  function close() {
    return act(async (found) => {
      const {opening} = load()
      const port = opening?.port ?? (await livePort()) ?? configuredPort()
      if (port) {
        const {mapping, pcIp} = await net.mapping(found, port)
        if (['pc', 'pc-before'].includes(mappingOwner(mapping, pcIp, opening)))
          await net.remove(found, port)
      }
      save({opening: null})
      logger.info('router port closed', {port})
    })
  }

  /**
   * Keeps the app's opening (upkeepAction): closes it at the user's end, makes it again for this computer's new
   * address, the node's new port or after the router lost it, renews it near the end of a router lease shorter
   * than the user's choice, and makes it again once when no peer connected from outside after a change. Nothing
   * when this computer is on another network: the router's lease ends the opening there.
   */
  function upkeep() {
    return exclusive(async () => {
      const {opening} = load()
      if (!opening) return 'nothing'
      const here = await net.gatewayAt(
        opening.gateway.location,
        opening.gateway.udn
      )
      if (!here) return 'nothing'
      const nodePort = await livePort()
      const nowMs = now()
      // While the node does not run, no peer can come: only the user's end is kept.
      if (nodePort == null && nowMs < opening.endMs) return 'nothing'
      const {mapping, pcIp} = await net.mapping(here, opening.port)
      const action = upkeepAction({
        opening,
        mapping,
        pcIp,
        nodePort,
        nowMs,
        validationRuns: await validationRuns(),
        inboundSinceChange: inboundSince(opening),
      })
      const lease = leaseSeconds(opening, nowMs)
      const owned = ['pc', 'pc-before'].includes(
        mappingOwner(mapping, pcIp, opening)
      )
      const changed = {gateway: here, client: pcIp, changedAtMs: nowMs}
      switch (action) {
        case 'close':
          if (owned) await net.remove(here, opening.port)
          save({opening: null})
          break
        case 'forget':
          save({opening: null})
          break
        case 'move': {
          if (owned) await net.remove(here, opening.port)
          const target = await net.mapping(here, nodePort)
          await net.open(
            here,
            nodePort,
            pcIp,
            lease,
            target.mapping?.client === pcIp
          )
          save({
            opening: {...opening, ...changed, port: nodePort, retried: false},
          })
          break
        }
        case 'open':
          await net.open(here, opening.port, pcIp, lease, mapping != null)
          save({opening: {...opening, ...changed, retried: false}})
          break
        case 'renew':
          await net.open(here, opening.port, pcIp, lease, true)
          save({opening: {...opening, ...changed}})
          break
        case 'retry':
          await net.open(here, opening.port, pcIp, lease, true)
          save({opening: {...opening, ...changed, retried: true}})
          break
        default:
      }
      if (action !== 'nothing') logger.info('router port upkeep', {action})
      return action
    })
  }

  return {status, searchAgain, open, close, upkeep}
}

module.exports = {
  UPKEEP_INTERVAL_MS,
  createRouterPortService,
}
