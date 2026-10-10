const {
  defaultGateways,
  parseLinuxRoutes,
  parseMacRoute,
  parseWindowsRoutes,
} = require('./default-gateway')

// A laptop on Wi-Fi with Docker (2026-10-10), plus a wired default route with a lower metric and one that is down.
const LINUX = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
wlo1\t00000000\t0102A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0
docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0
eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
eth1\t00000000\t01000A0A\t0002\t0\t0\t50\t00000000\t0\t0\t0
wlo1\t0002A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0
`

const MAC = `   route to: default
destination: default
       mask: default
    gateway: 192.168.2.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
 recvpipe  sendpipe  ssthresh  rtt,msec    rttvar  hopcount      mtu     expire
       0         0         0         0         0         0      1500         0
`

const WINDOWS = `===========================================================================
Liste d'Interfaces
 12...a4 c3 f0 11 22 33 ......Intel(R) Wi-Fi 6 AX201 160MHz
  1...........................Software Loopback Interface 1
===========================================================================

IPv4 Table de routage
===========================================================================
Itinéraires actifs :
Destination réseau    Masque réseau  Adr. passerelle   Adr. interface Métrique
          0.0.0.0          0.0.0.0      192.168.2.1     192.168.2.97     35
          0.0.0.0          0.0.0.0         On-link        10.8.0.2      5
===========================================================================
Itinéraires persistants :
  Adresse réseau    Masque réseau  Adresse passerelle Métrique
          0.0.0.0          0.0.0.0      192.168.2.1  Par défaut
===========================================================================
`

describe('the default gateways', () => {
  it("reads Linux's table: default routes that are up, the lowest metric first", () => {
    expect(parseLinuxRoutes(LINUX)).toEqual(['192.168.1.1', '192.168.2.1'])
    expect(parseLinuxRoutes('')).toEqual([])
  })

  it("reads macOS's and Windows' route commands", () => {
    expect(parseMacRoute(MAC)).toEqual(['192.168.2.1'])
    expect(
      parseMacRoute('route: writing to routing socket: not in table')
    ).toEqual([])
    expect(parseWindowsRoutes(WINDOWS)).toEqual(['192.168.2.1', '192.168.2.1'])
    expect(parseWindowsRoutes(WINDOWS.replace(/\n/g, '\r\n'))).toEqual([
      '192.168.2.1',
      '192.168.2.1',
    ])
  })

  it('keeps home networks only, once each, and none when the table cannot be read', async () => {
    const run = jest.fn(async () => WINDOWS)
    expect(await defaultGateways({platform: 'win32', run})).toEqual([
      '192.168.2.1',
    ])
    expect(run.mock.calls[0][0]).toMatch(/System32[\\/]route\.exe$/)
    expect(run.mock.calls[0][1]).toEqual(['print', '0.0.0.0'])

    expect(
      await defaultGateways({
        platform: 'darwin',
        run: async (file, args) =>
          file === '/sbin/route' && args.join(' ') === '-n get default'
            ? MAC.replace('192.168.2.1', '100.64.0.1')
            : '',
      })
    ).toEqual([])
    expect(
      await defaultGateways({
        platform: 'linux',
        readFile: async (file) => (file === '/proc/net/route' ? LINUX : ''),
      })
    ).toEqual(['192.168.1.1', '192.168.2.1'])
    expect(
      await defaultGateways({
        platform: 'linux',
        readFile: async () => {
          throw new Error('EACCES')
        },
      })
    ).toEqual([])
    expect(await defaultGateways({platform: 'freebsd'})).toEqual([])
  })
})
