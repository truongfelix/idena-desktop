import {QUIET_HINT_MS, openingEnd, routerPortView} from './router-port'

// Interpolates as i18next does, so that the lines read as the user sees them in English.
const t = (key, values = {}) =>
  key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]))

const NOW = Date.UTC(2026, 9, 8, 20)
const found = (fields) => ({
  state: 'found',
  name: 'Livebox',
  port: 50506,
  pcIp: '192.168.1.20',
  mapping: null,
  owner: 'none',
  opening: null,
  inbound: null,
  ...fields,
})

describe('the Router port row', () => {
  it('says how long the search has run', () => {
    expect(
      routerPortView({state: 'searching', startedMs: NOW}, t, NOW)
    ).toEqual({
      line: 'Looking for the router of this network… Some routers announce themselves only every 15 minutes.',
      color: 'muted',
    })
    expect(
      routerPortView({state: 'searching', startedMs: NOW}, t, NOW + 7.5 * 60000)
        .line
    ).toMatch(/\(7 min so far\)\.$/)
  })

  it('names the router that answered without port opening', () => {
    const heard = 'Speedport Smart 4 Typ B'
    expect(
      routerPortView({state: 'searching', startedMs: NOW, heard}, t, NOW)
    ).toEqual({
      line: 'Looking for the router of this network… Speedport Smart 4 Typ B answered, without port opening (UPnP). Some routers announce themselves only every 15 minutes.',
      color: 'muted',
    })
    expect(
      routerPortView(
        {state: 'searching', startedMs: NOW, heard},
        t,
        NOW + 3 * 60000
      ).line
    ).toBe(
      'Looking for the router of this network… Speedport Smart 4 Typ B answered, without port opening (UPnP). Some routers announce themselves only every 15 minutes (3 min so far).'
    )
    expect(routerPortView({state: 'not-found', heard}, t, NOW)).toEqual({
      line: "Speedport Smart 4 Typ B offers no port opening (UPnP): it may be turned off in the router's settings",
      color: 'muted',
      action: 'search-again',
    })
  })

  it('offers to look for the router, and waits for the node', () => {
    expect(routerPortView({state: 'idle'}, t, NOW)).toEqual({
      line: "The app looks for this network's router only when you ask. Some routers announce themselves only every 15 minutes.",
      color: 'muted',
      action: 'look',
    })
    expect(routerPortView({state: 'node-stopped'}, t, NOW)).toEqual({
      line: 'Shown while the node runs.',
      color: 'muted',
    })
  })

  it('offers a search again, or a new try after an error', () => {
    expect(routerPortView({state: 'not-found'}, t, NOW)).toEqual({
      line: 'No router with UPnP heard on this network',
      color: 'muted',
      action: 'search-again',
    })
    expect(
      routerPortView(
        {state: 'failed', message: 'the router did not answer in time'},
        t,
        NOW
      )
    ).toEqual({
      line: 'Router: the router did not answer in time',
      color: 'red.500',
      action: 'try-again',
    })
  })

  it('offers Open when closed, Close when open for this computer, nothing for another device', () => {
    expect(routerPortView(found(), t, NOW)).toEqual({
      line: 'Closed on Livebox',
      color: 'muted',
      action: 'open',
    })
    const open = routerPortView(
      found({
        owner: 'pc',
        mapping: {client: '192.168.1.20', leaseSeconds: 3600},
        opening: {
          client: '192.168.1.20',
          port: 50506,
          endMs: NOW + 6 * 3600000,
        },
        inbound: 3,
      }),
      t,
      NOW
    )
    expect(open.action).toBe('close')
    expect(open.line).toMatch(
      /^Open on Livebox until .+ · 3 peers connected from outside since$/
    )
    expect(
      routerPortView(
        found({
          owner: 'pc',
          mapping: {client: '192.168.1.20', leaseSeconds: 0},
        }),
        t,
        NOW
      ).line
    ).toBe('Open on Livebox with no end')
    expect(
      routerPortView(
        found({
          owner: 'pc',
          mapping: {client: '192.168.1.20', leaseSeconds: 0},
          opening: {client: '192.168.1.20', endMs: NOW + 3600000},
          inbound: 1,
        }),
        t,
        NOW
      ).line
    ).toMatch(/ · 1 peer connected from outside since$/)
    expect(routerPortView(found({owner: 'pc-before'}), t, NOW)).toEqual({
      line: "Open on Livebox for this computer's former address; the app moves it to the new one",
      color: 'muted',
      action: 'close',
    })
    expect(
      routerPortView(
        found({owner: 'other', mapping: {client: '192.168.1.30'}}),
        t,
        NOW
      )
    ).toEqual({
      line: 'Port 50506 on Livebox goes to another device (192.168.1.30)',
      color: 'muted',
    })
  })

  it("points at this computer's firewall when no peer came from outside", () => {
    const quiet = (fields, nowMs, options = {nodeStarted: true}) =>
      routerPortView(
        found({
          owner: 'pc',
          mapping: {client: '192.168.1.20', leaseSeconds: 3600},
          opening: {
            client: '192.168.1.20',
            port: 50506,
            endMs: NOW + 6 * 3600000,
            changedAtMs: NOW,
          },
          inbound: 0,
          ...fields,
        }),
        t,
        nowMs,
        options
      ).hint
    expect(quiet({}, NOW + QUIET_HINT_MS + 30000)).toBe(
      'No node from outside has connected for 10 min. If this computer has a firewall, it must let in TCP port 50506.'
    )
    expect(quiet({}, NOW + QUIET_HINT_MS - 60000)).toBeNull()
    expect(quiet({inbound: 1}, NOW + QUIET_HINT_MS)).toBeNull()
    expect(quiet({inbound: null}, NOW + QUIET_HINT_MS)).toBeNull()
    expect(quiet({}, NOW + QUIET_HINT_MS, {nodeStarted: false})).toBeNull()
    expect(quiet({}, NOW + QUIET_HINT_MS, {})).toBeNull()
    expect(
      quiet(
        {
          opening: {
            client: '192.168.1.19',
            endMs: NOW + 3600000,
            changedAtMs: NOW,
          },
        },
        NOW + QUIET_HINT_MS
      )
    ).toBeNull()
  })

  it("ends at the user's end, else at the router's lease", () => {
    const mapping = {client: '192.168.1.20', leaseSeconds: 600}
    expect(
      openingEnd(
        found({mapping, opening: {client: '192.168.1.20', endMs: NOW + 5}}),
        NOW
      )
    ).toBe(NOW + 5)
    // An opening made for the address this computer had before: the router's lease.
    expect(
      openingEnd(
        found({mapping, opening: {client: '192.168.1.19', endMs: NOW + 5}}),
        NOW
      )
    ).toBe(NOW + 600000)
    expect(openingEnd(found({mapping: {leaseSeconds: 0}}), NOW)).toBeNull()
  })
})
