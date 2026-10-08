const {
  PORT_DURATIONS,
  PORT_MAPPING_DESCRIPTION,
  RETRY_AFTER_MS,
  addPortMappingArgs,
  cleanOpening,
  durationEnd,
  inboundPeersSince,
  ipfsAddressPort,
  isLocalNetworkHost,
  mappingOwner,
  parseGateway,
  parseSoap,
  parseSsdp,
  portMapping,
  soapEnvelope,
  upkeepAction,
} = require('./router-port')

const LOCATION = 'http://192.168.1.1:49152/rootDesc.xml'

const description = ({services, urlBase = ''}) => `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">${urlBase}
<device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
<friendlyName>Livebox &amp; co</friendlyName><UDN>uuid:root-1</UDN>
<deviceList><device><friendlyName>WAN device</friendlyName><UDN>uuid:wan-2</UDN><serviceList>
${services
  .map(
    ([type, control]) =>
      `<service><serviceType>${type}</serviceType><controlURL>${control}</controlURL></service>`
  )
  .join('\n')}
</serviceList></device></deviceList></device></root>`

const WANIP1 = 'urn:schemas-upnp-org:service:WANIPConnection:1'
const WANIP2 = 'urn:schemas-upnp-org:service:WANIPConnection:2'

describe('isLocalNetworkHost', () => {
  it('takes the home network ranges only', () => {
    expect(
      ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.1.1'].map(
        isLocalNetworkHost
      )
    ).toEqual([true, true, true, true])
    expect(
      [
        '172.32.0.1',
        '8.8.8.8',
        '127.0.0.1',
        '192.169.1.1',
        '192.168.1.256',
        'router.local',
        '',
        null,
      ].map(isLocalNetworkHost)
    ).toEqual([false, false, false, false, false, false, false, false])
  })
})

describe('parseSsdp', () => {
  it('reads an announcement and an answer', () => {
    expect(
      parseSsdp(
        `NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nLOCATION: ${LOCATION}\r\nNT: ${WANIP1}\r\nNTS: ssdp:alive\r\n\r\n`
      )
    ).toEqual({notify: true, location: LOCATION, type: WANIP1, alive: true})
    expect(
      parseSsdp(
        `HTTP/1.1 200 OK\r\nST: ${WANIP1}\r\nLocation: ${LOCATION}\r\n\r\n`
      )
    ).toEqual({notify: false, location: LOCATION, type: WANIP1, alive: true})
    expect(
      parseSsdp(`NOTIFY * HTTP/1.1\nLOCATION: ${LOCATION}\nNTS: ssdp:byebye\n`)
        .alive
    ).toBe(false)
  })

  it('drops other datagrams and descriptions outside the home network', () => {
    expect(parseSsdp(`M-SEARCH * HTTP/1.1\r\nST: ${WANIP1}\r\n\r\n`)).toBeNull()
    expect(parseSsdp('HTTP/1.1 200 OK\r\nST: x\r\n\r\n')).toBeNull()
    expect(
      parseSsdp(
        'HTTP/1.1 200 OK\r\nLOCATION: https://192.168.1.1/d.xml\r\n\r\n'
      )
    ).toBeNull()
    expect(
      parseSsdp(
        'NOTIFY * HTTP/1.1\r\nLOCATION: http://203.0.113.5/d.xml\r\n\r\n'
      )
    ).toBeNull()
    expect(
      parseSsdp('NOTIFY * HTTP/1.1\r\nLOCATION: http://127.0.0.1:9119/\r\n\r\n')
    ).toBeNull()
  })
})

describe('parseGateway', () => {
  it('finds the forwarding service, its control address and the root device', () => {
    expect(
      parseGateway(
        LOCATION,
        description({
          services: [
            ['urn:x:other:1', '/x'],
            [WANIP1, '/ctl/IPConn'],
          ],
        })
      )
    ).toEqual({
      name: 'Livebox & co',
      udn: 'uuid:root-1',
      location: LOCATION,
      controlUrl: 'http://192.168.1.1:49152/ctl/IPConn',
      service: WANIP1,
    })
  })

  it('prefers WANIPConnection 2 and follows URLBase', () => {
    const gateway = parseGateway(
      LOCATION,
      description({
        services: [
          [WANIP1, '/one'],
          [WANIP2, 'two'],
        ],
        urlBase: '<URLBase>http://192.168.1.1:5000/base/</URLBase>',
      })
    )
    expect(gateway.service).toBe(WANIP2)
    expect(gateway.controlUrl).toBe('http://192.168.1.1:5000/base/two')
  })

  it('refuses a description without forwarding, or that sends requests elsewhere', () => {
    expect(
      parseGateway(LOCATION, description({services: [['urn:x:other:1', '/x']]}))
    ).toBeNull()
    expect(
      parseGateway(
        LOCATION,
        description({services: [[WANIP1, 'http://203.0.113.5/ctl']]})
      )
    ).toBeNull()
    expect(
      parseGateway(
        LOCATION,
        description({services: [[WANIP1, 'http://192.168.1.2/ctl']]})
      )
    ).toBeNull()
    expect(
      parseGateway(
        'http://203.0.113.5/rootDesc.xml',
        description({services: [[WANIP1, '/ctl']]})
      )
    ).toBeNull()
  })
})

describe('SOAP', () => {
  it('escapes the arguments in order', () => {
    const body = soapEnvelope(WANIP1, 'AddPortMapping', [
      ['NewA', '1'],
      ['NewB', 'a<b&"c"'],
    ])
    expect(body).toContain(
      `<u:AddPortMapping xmlns:u="${WANIP1}"><NewA>1</NewA><NewB>a&lt;b&amp;&quot;c&quot;</NewB></u:AddPortMapping>`
    )
  })

  it('reads the fields, a UPnP error and an HTTP error', () => {
    const answer = parseSoap(
      200,
      '<s:Body><u:R><NewInternalClient>192.168.1.20</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>a &amp; b</NewPortMappingDescription><NewLeaseDuration>3600</NewLeaseDuration></u:R></s:Body>'
    )
    expect(answer.ok).toBe(true)
    expect(portMapping(answer)).toEqual({
      client: '192.168.1.20',
      description: 'a & b',
      enabled: true,
      leaseSeconds: 3600,
    })
    expect(
      parseSoap(
        500,
        '<UPnPError><errorCode>714</errorCode><errorDescription>NoSuchEntryInArray</errorDescription></UPnPError>'
      )
    ).toEqual({ok: false, errorCode: 714, errorText: 'NoSuchEntryInArray'})
    expect(parseSoap(404, '<html>no</html>')).toEqual({
      ok: false,
      errorCode: -1,
      errorText: 'HTTP 404',
    })
    expect(portMapping(parseSoap(500, '<errorCode>714</errorCode>'))).toBeNull()
  })

  it('forwards the same port on both sides under the app name', () => {
    expect(
      Object.fromEntries(addPortMappingArgs(50506, '192.168.1.20', 60))
    ).toEqual({
      NewRemoteHost: '',
      NewExternalPort: '50506',
      NewProtocol: 'TCP',
      NewInternalPort: '50506',
      NewInternalClient: '192.168.1.20',
      NewEnabled: '1',
      NewPortMappingDescription: PORT_MAPPING_DESCRIPTION,
      NewLeaseDuration: '60',
    })
  })
})

describe('durationEnd', () => {
  const HOUR = 3600 * 1000
  const now = Date.UTC(2026, 9, 8, 20)
  it('counts the hours, or the validation + 2 h while it is ahead', () => {
    const byValue = Object.fromEntries(
      PORT_DURATIONS.map((it) => [it.value, it])
    )
    expect(durationEnd(byValue['6h'], now, null)).toBe(now + 6 * HOUR)
    expect(durationEnd(byValue['7d'], now, null)).toBe(now + 168 * HOUR)
    expect(durationEnd(byValue.validation, now, now + 10 * HOUR)).toBe(
      now + 12 * HOUR
    )
    expect(durationEnd(byValue.validation, now, now - HOUR)).toBeNull()
    expect(durationEnd(byValue.validation, now, null)).toBeNull()
    expect(durationEnd(undefined, now, null)).toBeNull()
  })
})

const GATEWAY = {
  name: 'Livebox',
  udn: 'uuid:root-1',
  location: LOCATION,
  controlUrl: 'http://192.168.1.1:49152/ctl/IPConn',
  service: WANIP1,
}

describe('cleanOpening', () => {
  const opening = {
    gateway: GATEWAY,
    port: 50506,
    client: '192.168.1.20',
    endMs: 2000,
    changedAtMs: 1000,
  }
  it('keeps a valid opening', () => {
    expect(cleanOpening(opening)).toEqual({...opening, retried: false})
  })
  it('drops a broken one', () => {
    expect(cleanOpening(null)).toBeNull()
    expect(cleanOpening({...opening, port: 70000})).toBeNull()
    expect(cleanOpening({...opening, client: 'x'})).toBeNull()
    expect(cleanOpening({...opening, endMs: '2000'})).toBeNull()
    expect(
      cleanOpening({
        ...opening,
        gateway: {...GATEWAY, location: 'http://8.8.8.8/'},
      })
    ).toBeNull()
  })
})

describe('upkeepAction', () => {
  const now = 10 * 24 * 3600 * 1000
  const opening = {
    gateway: GATEWAY,
    port: 50506,
    client: '192.168.1.20',
    endMs: now + 3 * 3600 * 1000,
    changedAtMs: now - 60 * 1000,
    retried: false,
  }
  const mine = (leaseSeconds) => ({
    client: '192.168.1.20',
    description: PORT_MAPPING_DESCRIPTION,
    enabled: true,
    leaseSeconds,
  })
  const base = {
    opening,
    mapping: mine(3 * 3600),
    pcIp: '192.168.1.20',
    nodePort: 50506,
    nowMs: now,
    validationRuns: false,
    inboundSinceChange: 2,
  }

  it('keeps a forwarding that lasts to the end', () => {
    expect(upkeepAction(base)).toBe('nothing')
    expect(upkeepAction({...base, mapping: mine(0)})).toBe('nothing')
  })

  it("closes at the user's end, or forgets an opening another device took", () => {
    const late = {...base, nowMs: opening.endMs}
    expect(upkeepAction(late)).toBe('close')
    expect(upkeepAction({...late, mapping: null})).toBe('close')
    expect(
      upkeepAction({
        ...late,
        mapping: {...mine(0), client: '192.168.1.30', description: 'x'},
      })
    ).toBe('forget')
  })

  it("follows the node's port", () => {
    expect(upkeepAction({...base, nodePort: 50507})).toBe('move')
    expect(upkeepAction({...base, nodePort: null})).toBe('nothing')
  })

  it('makes it again when lost or for a new address, never over another device', () => {
    expect(upkeepAction({...base, mapping: null})).toBe('open')
    expect(upkeepAction({...base, pcIp: '192.168.1.21'})).toBe('open')
    expect(
      upkeepAction({
        ...base,
        mapping: {...mine(0), client: '192.168.1.30', description: 'x'},
      })
    ).toBe('nothing')
  })

  it("renews a router lease shorter than the user's choice near its end, not during the validation", () => {
    expect(upkeepAction({...base, mapping: mine(20 * 60)})).toBe('renew')
    expect(upkeepAction({...base, mapping: mine(40 * 60)})).toBe('nothing')
    expect(
      upkeepAction({...base, mapping: mine(20 * 60), validationRuns: true})
    ).toBe('nothing')
    expect(
      upkeepAction({...base, mapping: mine(120), validationRuns: true})
    ).toBe('renew')
  })

  it('makes it again once when no peer came from outside', () => {
    const quiet = {
      ...base,
      opening: {...opening, changedAtMs: now - RETRY_AFTER_MS},
      inboundSinceChange: 0,
    }
    expect(upkeepAction(quiet)).toBe('retry')
    expect(upkeepAction({...quiet, inboundSinceChange: null})).toBe('nothing')
    expect(
      upkeepAction({...quiet, opening: {...quiet.opening, retried: true}})
    ).toBe('nothing')
    expect(
      upkeepAction({
        ...quiet,
        opening: {...opening, changedAtMs: now - 60 * 1000},
      })
    ).toBe('nothing')
  })
})

describe('mappingOwner', () => {
  const opening = {client: '192.168.1.20'}
  it('tells this computer, its former address and another device apart', () => {
    expect(mappingOwner(null, '192.168.1.20', opening)).toBe('none')
    expect(mappingOwner({client: '192.168.1.20'}, '192.168.1.20', null)).toBe(
      'pc'
    )
    expect(
      mappingOwner(
        {client: '192.168.1.20', description: PORT_MAPPING_DESCRIPTION},
        '192.168.1.21',
        opening
      )
    ).toBe('pc-before')
    expect(
      mappingOwner(
        {client: '192.168.1.20', description: 'game'},
        '192.168.1.21',
        opening
      )
    ).toBe('other')
    expect(
      mappingOwner(
        {client: '192.168.1.20', description: PORT_MAPPING_DESCRIPTION},
        '192.168.1.21',
        null
      )
    ).toBe('other')
  })
})

describe('ipfsAddressPort', () => {
  it("reads the port of the node's IPFS address", () => {
    expect(ipfsAddressPort('/ip4/0.0.0.0/tcp/50506/ipfs/QmX')).toBe(50506)
    expect(ipfsAddressPort('/ip4/0.0.0.0/tcp/40405')).toBe(40405)
    expect(ipfsAddressPort('/ip4/0.0.0.0/udp/40405/quic')).toBeNull()
    expect(ipfsAddressPort(null)).toBeNull()
  })
})

describe('inboundPeersSince', () => {
  const log = [
    'INFO [10-08|16:29:00.001] Peer connected                           id=QmA inbound=true shardId=0',
    'INFO [10-08|16:31:00.001] Peer connected                           id=QmB inbound=true shardId=0',
    'INFO [10-08|16:32:00.001] Peer connected                           id=QmC inbound=false shardId=0',
    'INFO [10-08|16:33:00.001] Peer connected                           id=QmD inbound=true shardId=0 direct=true',
    'INFO [10-08|16:34:00.001] Peer disconnected                        id=QmB inbound=true',
  ].join('\n')

  it('counts the peers that connected from outside in the window (UTC)', () => {
    const since = Date.UTC(2026, 9, 8, 16, 30)
    expect(inboundPeersSince(log, since, Date.UTC(2026, 9, 8, 17))).toBe(2)
    expect(inboundPeersSince(log, since, Date.UTC(2026, 9, 8, 16, 31))).toBe(1)
    expect(inboundPeersSince('', since, since)).toBe(0)
  })

  it('wraps over New Year', () => {
    const tail = [
      'INFO [12-31|23:59:00.000] Peer connected id=QmA inbound=true',
      'INFO [01-01|00:01:00.000] Peer connected id=QmB inbound=true',
      'INFO [06-01|00:01:00.000] Peer connected id=QmC inbound=true',
    ].join('\n')
    expect(
      inboundPeersSince(
        tail,
        Date.UTC(2026, 11, 31, 23),
        Date.UTC(2027, 0, 1, 1)
      )
    ).toBe(2)
  })
})
