const fs = require('fs')
const path = require('path')
const {execFile} = require('child_process')
const {isLocalNetworkHost} = require('./router-port')

// The routers of the networks this computer is on: the gateways of its default IPv4 routes. Node has no API for
// them, so each system's own table is read: Linux's /proc/net/route, the `route` command on macOS and Windows.
// The router search (main/router-net.js) names the device at one of these addresses when it offers no port
// opening, and no other device.

const COMMAND_MS = 3000

/** IPv4 dotted quads, an address each. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * The gateways of the default routes in Linux's /proc/net/route, the lowest metric first: its addresses are hex
 * in the host's byte order (little-endian on the x64 and arm64 builds).
 */
function parseLinuxRoutes(text) {
  const routes = []
  for (const line of String(text).split('\n').slice(1)) {
    const [, destination, gateway, flags, , , metric, mask] = line
      .trim()
      .split(/\s+/)
    // Both RTF_UP (1) and RTF_GATEWAY (2) set.
    const up = Number.parseInt(flags, 16) % 4 === 3
    if (
      up &&
      destination === '00000000' &&
      mask === '00000000' &&
      /^[0-9A-Fa-f]{8}$/.test(gateway)
    ) {
      const address = [3, 2, 1, 0]
        .map((i) => Number.parseInt(gateway.slice(i * 2, i * 2 + 2), 16))
        .join('.')
      routes.push({address, metric: Number.parseInt(metric, 10) || 0})
    }
  }
  return routes.sort((a, b) => a.metric - b.metric).map((it) => it.address)
}

/** The gateway in macOS's `route -n get default` (`    gateway: 192.168.2.1`). */
function parseMacRoute(text) {
  const address = /^\s*gateway:\s*(\S+)\s*$/m.exec(String(text))?.[1]
  return address && IPV4.test(address) ? [address] : []
}

/**
 * The gateways of the default routes in Windows' `route print 0.0.0.0`: the lines "0.0.0.0 0.0.0.0 <gateway> …"
 * (the table's headers are in the system's language, its numbers are not).
 */
function parseWindowsRoutes(text) {
  const routes = []
  for (const line of String(text).split(/\r?\n/)) {
    const [destination, mask, gateway] = line.trim().split(/\s+/)
    if (destination === '0.0.0.0' && mask === '0.0.0.0' && IPV4.test(gateway))
      routes.push(gateway)
  }
  return routes
}

/** The output of `file` run with `args`, or '' when it fails or takes too long. */
function runCommand(file, args) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {timeout: COMMAND_MS, windowsHide: true},
      (error, stdout) => resolve(error ? '' : String(stdout))
    )
  })
}

/**
 * This computer's default gateways on home networks, without repeats; none when the system's table cannot be read.
 * `platform`, `run` (as runCommand) and `readFile` are for the tests.
 */
async function defaultGateways({
  platform = process.platform,
  run = runCommand,
  readFile = (file) => fs.promises.readFile(file, 'utf8'),
} = {}) {
  let found = []
  try {
    if (platform === 'linux') {
      found = parseLinuxRoutes(await readFile('/proc/net/route'))
    } else if (platform === 'darwin') {
      found = parseMacRoute(await run('/sbin/route', ['-n', 'get', 'default']))
    } else if (platform === 'win32') {
      const system = process.env.SystemRoot || 'C:\\Windows'
      found = parseWindowsRoutes(
        await run(path.win32.join(system, 'System32', 'route.exe'), [
          'print',
          '0.0.0.0',
        ])
      )
    }
  } catch {
    found = []
  }
  return [...new Set(found.filter(isLocalNetworkHost))]
}

module.exports = {
  defaultGateways,
  parseLinuxRoutes,
  parseMacRoute,
  parseWindowsRoutes,
}
