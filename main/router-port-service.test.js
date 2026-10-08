const fs = require('fs')
const os = require('os')
const path = require('path')
const {createRouterPortService} = require('./router-port-service')
const {PORT_MAPPING_DESCRIPTION, RETRY_AFTER_MS} = require('./router-port')

const GATEWAY = {
  name: 'Livebox',
  udn: 'uuid:root-1',
  location: 'http://192.168.1.1:49152/rootDesc.xml',
  controlUrl: 'http://192.168.1.1:49152/ctl/IPConn',
  service: 'urn:schemas-upnp-org:service:WANIPConnection:1',
}
const PC = '192.168.1.20'
const HOUR = 3600 * 1000
const NOW = Date.UTC(2026, 9, 8, 20)

/** A router in memory: its forwardings by port, and whether it answers. */
function routerInMemory() {
  const router = {mappings: new Map(), answers: true, calls: []}
  let resolveFind
  const net = {
    router,
    pcIp: PC,
    find: jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFind = resolve
        })
    ),
    finish: async (gateway) => {
      resolveFind(gateway)
      await new Promise((resolve) => {
        setImmediate(resolve)
      })
    },
    knownHere: jest.fn(async (known) =>
      router.answers && known.some((it) => it?.udn === GATEWAY.udn)
        ? GATEWAY
        : null
    ),
    gatewayAt: jest.fn(async (location, udn) =>
      router.answers && udn === GATEWAY.udn ? GATEWAY : null
    ),
    mapping: jest.fn(async (gateway, port) => {
      if (!router.answers) throw new Error('the router did not answer in time')
      return {mapping: router.mappings.get(port) || null, pcIp: net.pcIp}
    }),
    remove: jest.fn(async (gateway, port) => {
      router.calls.push(['remove', port])
      router.mappings.delete(port)
    }),
    open: jest.fn(async (gateway, port, client, lease, replace) => {
      router.calls.push(['open', port, client, lease, replace])
      if (replace) router.mappings.delete(port)
      if (router.mappings.has(port))
        throw new Error('the router refused (718 ConflictInMappingEntry)')
      router.mappings.set(port, {
        client,
        description: PORT_MAPPING_DESCRIPTION,
        enabled: true,
        leaseSeconds: lease,
      })
    }),
  }
  return net
}

function setup({net = routerInMemory(), dir} = {}) {
  const folder = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'router-port-'))
  const file = path.join(folder, 'router-port.json')
  const node = {port: 50506, period: 'None', answers: true, log: ''}
  let clock = NOW
  const service = createRouterPortService({
    file: () => file,
    net,
    async nodeRpc(method) {
      if (!node.answers) throw new Error('connect ECONNREFUSED')
      if (method === 'net_ipfsAddress')
        return `/ip4/0.0.0.0/tcp/${node.port}/ipfs/QmX`
      return {currentPeriod: node.period}
    },
    configuredPort: () => 50506,
    nodeLogTail: () => node.log,
    logger: {info: jest.fn(), warn: jest.fn()},
    now: () => clock,
  })
  const saved = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    service,
    net,
    node,
    folder,
    file,
    saved,
    advance: (ms) => {
      clock += ms
    },
    now: () => clock,
  }
}

/** A service whose search found the router. */
async function found() {
  const env = setup()
  env.service.searchAgain()
  await env.net.finish(GATEWAY)
  return env
}

describe('the router search', () => {
  it('runs only when the user asks, and is remembered', async () => {
    const env = setup()
    expect(await env.service.status()).toEqual({state: 'idle'})
    expect(env.net.find).not.toHaveBeenCalled()
    expect(env.service.searchAgain()).toEqual({
      state: 'searching',
      startedMs: NOW,
    })
    expect(await env.service.status()).toEqual({
      state: 'searching',
      startedMs: NOW,
    })
    // A second click while it runs starts no other search.
    env.service.searchAgain()
    await env.net.finish(GATEWAY)
    expect(await env.service.status()).toMatchObject({
      state: 'found',
      name: 'Livebox',
      port: 50506,
      pcIp: PC,
      owner: 'none',
      opening: null,
    })
    expect(env.saved().gateways).toEqual([GATEWAY])

    // After a restart of the app: the router known before answers, no search.
    const again = setup({net: env.net, dir: env.folder})
    expect(await again.service.status()).toMatchObject({state: 'found'})
    expect(env.net.find).toHaveBeenCalledTimes(1)
  })

  it('says when no router was heard, and never looks again by itself', async () => {
    const env = setup()
    env.service.searchAgain()
    await env.net.finish(null)
    expect(await env.service.status()).toEqual({state: 'not-found'})
    env.advance(48 * HOUR)
    expect(await env.service.status({retry: true})).toEqual({
      state: 'not-found',
    })
    expect(env.net.find).toHaveBeenCalledTimes(1)
    expect(env.service.searchAgain().state).toBe('searching')
    expect(env.net.find).toHaveBeenCalledTimes(2)
  })

  it('shows a router that stops answering until the user tries again', async () => {
    const env = await found()
    env.net.router.answers = false
    expect(await env.service.status()).toEqual({
      state: 'failed',
      message: 'the router did not answer in time',
    })
    expect((await env.service.status()).state).toBe('failed')
    expect(await env.service.status({retry: true})).toEqual({
      state: 'not-found',
    })
    env.net.router.answers = true
    expect((await env.service.status()).state).toBe('found')
  })

  it('waits for the node before reading a router with no opening', async () => {
    const env = setup()
    env.node.answers = false
    const service = createRouterPortService({
      file: () => env.file,
      net: env.net,
      nodeRpc: async () => {
        throw new Error('connect ECONNREFUSED')
      },
      configuredPort: () => null,
      nodeLogTail: () => '',
      logger: {info: jest.fn(), warn: jest.fn()},
      now: () => NOW,
    })
    service.searchAgain()
    await env.net.finish(GATEWAY)
    expect(await service.status()).toEqual({state: 'node-stopped'})
  })
})

describe('Open and Close', () => {
  it("opens the node's port until the end chosen, and closes it", async () => {
    const env = await found()
    const endMs = NOW + 6 * HOUR
    expect(await env.service.open({endMs})).toMatchObject({
      state: 'found',
      owner: 'pc',
      port: 50506,
      opening: {port: 50506, client: PC, endMs, changedAtMs: NOW},
      inbound: 0,
      error: null,
    })
    expect(env.net.router.calls).toEqual([['open', 50506, PC, 6 * 3600, false]])
    expect(env.saved().opening).toMatchObject({
      gateway: GATEWAY,
      port: 50506,
      client: PC,
      endMs,
      changedAtMs: NOW,
      retried: false,
    })

    expect(await env.service.close()).toMatchObject({
      owner: 'none',
      opening: null,
    })
    expect(env.net.router.mappings.size).toBe(0)
    expect(env.saved().opening).toBeNull()
  })

  it('opens the port the node listens on now, closing its own old one', async () => {
    const env = await found()
    await env.service.open({endMs: NOW + 6 * HOUR})
    env.node.port = 50507
    await env.service.open({endMs: NOW + 24 * HOUR})
    expect(env.net.router.calls.slice(1)).toEqual([
      ['remove', 50506],
      ['open', 50507, PC, 24 * 3600, false],
    ])
    expect([...env.net.router.mappings.keys()]).toEqual([50507])
  })

  it('refuses an end out of range and a port another device holds, and says why', async () => {
    const env = await found()
    expect(await env.service.open({endMs: NOW})).toMatchObject({
      owner: 'none',
      error: 'this end cannot be chosen',
    })
    expect(await env.service.open({endMs: NaN})).toMatchObject({
      error: 'this end cannot be chosen',
    })
    env.net.router.mappings.set(50506, {
      client: '192.168.1.30',
      description: 'game',
    })
    expect(await env.service.open({endMs: NOW + HOUR})).toMatchObject({
      owner: 'other',
      error: 'the port goes to another device',
    })
    expect(await env.service.close()).toMatchObject({
      owner: 'other',
      error: null,
    })
    expect(env.net.router.calls).toEqual([])
    expect(env.net.router.mappings.get(50506).client).toBe('192.168.1.30')
  })

  it('never changes the router for two requests at once', async () => {
    const env = await found()
    await env.service.open({endMs: NOW + HOUR})
    let release
    env.net.remove.mockImplementationOnce(
      (gateway, port) =>
        new Promise((resolve) => {
          release = () => {
            env.net.router.mappings.delete(port)
            resolve()
          }
        })
    )
    const closing = env.service.close()
    const upkeep = env.service.upkeep()
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    expect(release).toBeDefined()
    expect(env.net.gatewayAt).not.toHaveBeenCalled()
    release()
    await closing
    // The upkeep runs after the Close: the opening is gone.
    expect(await upkeep).toBe('nothing')
    expect(env.net.gatewayAt).not.toHaveBeenCalled()
  })
})

describe('the upkeep', () => {
  async function opened() {
    const env = await found()
    await env.service.open({endMs: NOW + 6 * HOUR})
    env.net.router.calls.length = 0
    return env
  }

  it('does nothing without an opening, or on another network', async () => {
    const env = await found()
    expect(await env.service.upkeep()).toBe('nothing')
    const open = await opened()
    open.net.router.answers = false
    expect(await open.service.upkeep()).toBe('nothing')
  })

  it("follows the node's port", async () => {
    const env = await opened()
    env.node.port = 50507
    expect(await env.service.upkeep()).toBe('move')
    expect(env.net.router.calls).toEqual([
      ['remove', 50506],
      ['open', 50507, PC, 6 * 3600, false],
    ])
    expect(env.saved().opening).toMatchObject({port: 50507, changedAtMs: NOW})
  })

  it("keeps only the user's end while the node is stopped", async () => {
    const env = await opened()
    env.node.answers = false
    env.net.router.mappings.clear()
    expect(await env.service.upkeep()).toBe('nothing')
    env.advance(6 * HOUR)
    env.net.router.mappings.set(50506, {
      client: PC,
      description: PORT_MAPPING_DESCRIPTION,
    })
    expect(await env.service.upkeep()).toBe('close')
    expect(env.net.router.mappings.size).toBe(0)
    expect(env.saved().opening).toBeNull()
  })

  it('makes it again when the router lost it or this computer has a new address', async () => {
    const env = await opened()
    env.node.log =
      'INFO [10-08|20:01:00.000] Peer connected id=QmA inbound=true'
    env.net.router.mappings.clear()
    env.advance(HOUR)
    expect(await env.service.upkeep()).toBe('open')
    expect(env.net.router.calls).toEqual([['open', 50506, PC, 5 * 3600, false]])
    env.net.pcIp = '192.168.1.21'
    expect(await env.service.upkeep()).toBe('open')
    expect(env.net.router.mappings.get(50506).client).toBe('192.168.1.21')
    expect(env.saved().opening.client).toBe('192.168.1.21')
  })

  it('forgets an opening another device took by the end', async () => {
    const env = await opened()
    env.advance(6 * HOUR)
    env.net.router.mappings.set(50506, {
      client: '192.168.1.30',
      description: 'game',
    })
    expect(await env.service.upkeep()).toBe('forget')
    expect(env.net.router.mappings.get(50506).client).toBe('192.168.1.30')
    expect(env.saved().opening).toBeNull()
  })

  it('makes it again once when no peer came from outside', async () => {
    const env = await opened()
    env.advance(RETRY_AFTER_MS)
    expect(await env.service.upkeep()).toBe('retry')
    expect(env.saved().opening.retried).toBe(true)
    env.advance(RETRY_AFTER_MS)
    expect(await env.service.upkeep()).toBe('nothing')

    const busy = await opened()
    busy.node.log =
      'INFO [10-08|20:02:00.000] Peer connected id=QmA inbound=true'
    busy.advance(RETRY_AFTER_MS)
    expect(await busy.service.upkeep()).toBe('nothing')
    expect((await busy.service.status()).inbound).toBe(1)
  })
})

it('reads a broken file as empty', async () => {
  const env = setup()
  fs.writeFileSync(
    env.file,
    '{"opening": {"port": "x"}, "gateways": [{"udn": 1}]'
  )
  expect(await env.service.status()).toEqual({state: 'idle'})
  expect(await env.service.upkeep()).toBe('nothing')
})
