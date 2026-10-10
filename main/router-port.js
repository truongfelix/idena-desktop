// The built-in node's port on the router of the network this computer is on, opened by UPnP for a time the user
// chooses, so that outside nodes can connect to it: the phone app's Router port. This file holds what needs no
// network: the SSDP and SOAP messages, the router's description, the durations, the opening the app made and
// what the upkeep does with it. main/router-net.js talks to the router; main/router-port-service.js runs the
// Advanced settings' row and the upkeep.

/** How the app names its opening on the router, where the router lists its port forwardings. */
const PORT_MAPPING_DESCRIPTION = 'idena-desktop node'

/** The longest lease UPnP IGD 2 promises; some routers refuse longer ones. */
const MAX_STANDARD_LEASE_SECONDS = 604800

/** What the app searches for: gateways (IGD 1 and 2) and their connection services. */
const SSDP_SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
]

/** The services that forward ports, the preferred first. */
const FORWARDING_SERVICES = SSDP_SEARCH_TARGETS.slice(2)

/**
 * Also searched for: every device's root, to name the router when it offers no forwarding service (its UPnP port
 * opening is off, or it announces it only from time to time).
 */
const SSDP_ROOT_DEVICE = 'upnp:rootdevice'

/** The longest router name the row shows. */
const DEVICE_NAME_MAX = 60

/** UPnP errors the app handles: no such opening, the port taken by another device, only no-end leases. */
const UPNP_NO_SUCH_ENTRY = 714
const UPNP_CONFLICT = 718
const UPNP_ONLY_PERMANENT_LEASES = 725

/** A router's lease shorter than this gets renewed (the upkeep runs every few minutes). */
const RENEW_BEFORE_SECONDS = 30 * 60

/** How long after a change the upkeep waits for an incoming peer before it makes the opening again, once. */
const RETRY_AFTER_MS = 5 * 60 * 1000

/** How long the user opens the port for; "until the validation" ends 2 hours after its start. */
const PORT_DURATIONS = [
  {value: '6h', label: '6 hours', hours: 6},
  {value: '1d', label: '1 day', hours: 24},
  {value: '3d', label: '3 days', hours: 72},
  {value: '7d', label: '7 days', hours: 168},
  {value: 'validation', label: 'Until the validation + 2 h', hours: null},
]

const HOUR_MS = 60 * 60 * 1000

/**
 * The end of an opening chosen at `nowMs` for `duration`, or null when it cannot be chosen (the next
 * validation, `validationMs`, unknown or already started).
 */
function durationEnd(duration, nowMs, validationMs) {
  if (!duration) return null
  if (duration.hours == null) {
    return validationMs > nowMs ? validationMs + 2 * HOUR_MS : null
  }
  return nowMs + duration.hours * HOUR_MS
}

/** The search the app sends for gateways, one per search target. */
function ssdpSearch(searchTarget) {
  return `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${searchTarget}\r\n\r\n`
}

/** Whether `host` is an IPv4 address of a home network (10/8, 172.16/12, 192.168/16): routers are only asked there. */
function isLocalNetworkHost(host) {
  const parts = String(host ?? '').split('.')
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p)))
    return false
  const [a, b] = parts.map(Number)
  if (parts.some((p) => Number(p) > 255)) return false
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  )
}

/** An http URL on the home network, or null. */
function localNetworkUrl(text) {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' && isLocalNetworkHost(url.hostname)
      ? url
      : null
  } catch {
    return null
  }
}

/**
 * An SSDP datagram: {notify, location, type, alive}, or null when it is neither an announcement nor an answer,
 * or its description is not on the home network.
 */
function parseSsdp(text) {
  const lines = String(text).split(/\r?\n/)
  const first = (lines[0] || '').trim().toUpperCase()
  const notify = first.startsWith('NOTIFY')
  if (!notify && !first.startsWith('HTTP/1.1 200')) return null
  const headers = {}
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':')
    if (i > 0)
      headers[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim()
  }
  const location = headers.LOCATION
  if (!localNetworkUrl(location)) return null
  return {
    notify,
    location,
    type: (notify ? headers.NT : headers.ST) || '',
    alive: (headers.NTS || '').toLowerCase() !== 'ssdp:byebye',
  }
}

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The text of the first <name> element in `xml`, unescaped and trimmed; null when none. */
function tag(xml, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return match ? xmlUnescape(match[1].trim()) : null
}

/**
 * The port forwarding service in a device description read at `location`: {name, udn, location, controlUrl,
 * service}, or null when it has none, or its control address is not on the router's own host. The root device
 * comes first in the description: its name and UDN are the first ones.
 */
function parseGateway(location, xml) {
  const base = localNetworkUrl(location)
  if (!base) return null
  const services = []
  for (const match of String(xml).matchAll(/<service>([\s\S]*?)<\/service>/g)) {
    const type = tag(match[1], 'serviceType')
    const control = tag(match[1], 'controlURL')
    if (type && control) services.push({type, control})
  }
  const service = FORWARDING_SERVICES.map((wanted) =>
    services.find((it) => it.type === wanted)
  ).find(Boolean)
  if (!service) return null
  let controlUrl
  try {
    controlUrl = new URL(service.control, tag(xml, 'URLBase') || location)
  } catch {
    return null
  }
  if (controlUrl.protocol !== 'http:' || controlUrl.hostname !== base.hostname)
    return null
  return {
    name: tag(xml, 'friendlyName') || 'Router',
    udn: tag(xml, 'UDN') || location,
    location,
    controlUrl: controlUrl.href,
    service: service.type,
  }
}

/** The name in a device description: its root device's friendly name, else its model; on one line, or null. */
function parseDeviceName(xml) {
  const name = ['friendlyName', 'modelName']
    .map((it) => tag(String(xml), it))
    .find((it) => it && it.trim())
  return name ? name.replace(/\s+/g, ' ').slice(0, DEVICE_NAME_MAX) : null
}

/** A gateway read from a file, or null. */
function cleanGateway(json) {
  if (!json || typeof json !== 'object') return null
  const fields = ['name', 'udn', 'location', 'controlUrl', 'service']
  if (!fields.every((field) => typeof json[field] === 'string')) return null
  if (!localNetworkUrl(json.location) || !localNetworkUrl(json.controlUrl))
    return null
  return Object.fromEntries(fields.map((field) => [field, json[field]]))
}

/** A SOAP request of `action` to `service`, with its arguments ([name, value] pairs) in order. */
function soapEnvelope(service, action, args) {
  const body = args
    .map(([name, value]) => `<${name}>${xmlEscape(value)}</${name}>`)
    .join('')
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${body}</u:${action}></s:Body></s:Envelope>`
}

/**
 * A router's answer: {ok, fields} with its output arguments, or {ok: false, errorCode, errorText} with the UPnP
 * error it returned; an error without a UPnP code (an HTTP error page) has code -1.
 */
function parseSoap(httpStatus, xml) {
  const code = Number.parseInt(tag(xml, 'errorCode'), 10)
  if (Number.isFinite(code)) {
    return {ok: false, errorCode: code, errorText: tag(xml, 'errorDescription')}
  }
  if (httpStatus !== 200) {
    return {ok: false, errorCode: -1, errorText: `HTTP ${httpStatus}`}
  }
  const fields = {}
  for (const match of String(xml).matchAll(/<(New\w+)>([^<]*)<\/\1>/g)) {
    fields[match[1]] = xmlUnescape(match[2])
  }
  return {ok: true, fields}
}

/** The arguments that name the forwarding of `port` (GetSpecificPortMappingEntry, DeletePortMapping). */
function portArgs(port) {
  return [
    ['NewRemoteHost', ''],
    ['NewExternalPort', String(port)],
    ['NewProtocol', 'TCP'],
  ]
}

/** AddPortMapping's arguments: `port` on the router to the same port on `client`, for `lease` seconds (0 = no end). */
function addPortMappingArgs(port, client, lease) {
  return [
    ...portArgs(port),
    ['NewInternalPort', String(port)],
    ['NewInternalClient', client],
    ['NewEnabled', '1'],
    ['NewPortMappingDescription', PORT_MAPPING_DESCRIPTION],
    ['NewLeaseDuration', String(lease)],
  ]
}

/**
 * The forwarding in a GetSpecificPortMappingEntry answer: {client, description, enabled, leaseSeconds} (lease 0
 * = no end), or null.
 */
function portMapping(answer) {
  if (!answer?.ok || !answer.fields.NewInternalClient) return null
  return {
    client: answer.fields.NewInternalClient,
    description: answer.fields.NewPortMappingDescription || '',
    enabled: answer.fields.NewEnabled !== '0',
    leaseSeconds: Number.parseInt(answer.fields.NewLeaseDuration, 10) || 0,
  }
}

/**
 * The opening the app made, read from a file: on which router (`gateway`), for which port and address of this
 * computer (`port`, `client`), until when the user chose (`endMs`), when the router's forwarding last changed
 * (`changedAtMs`) and whether it was made again once because no incoming peer came (`retried`). Null when invalid.
 */
function cleanOpening(json) {
  const gateway = cleanGateway(json?.gateway)
  if (!gateway) return null
  const {port, client, endMs, changedAtMs} = json
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!isLocalNetworkHost(client)) return null
  if (!Number.isFinite(endMs) || !Number.isFinite(changedAtMs)) return null
  return {
    gateway,
    port,
    client,
    endMs,
    changedAtMs,
    retried: json.retried === true,
  }
}

/** The lease to ask the router for at `nowMs`: the time left to the user's end, at least a minute. */
function leaseSeconds(opening, nowMs) {
  return Math.max(60, Math.floor((opening.endMs - nowMs) / 1000))
}

/**
 * Whose the router's forwarding of the port is, for this computer at `pcIp` and the app's `opening`: 'none',
 * 'pc', 'pc-before' (the app's, for an address this computer had before on this network) or 'other'.
 */
function mappingOwner(mapping, pcIp, opening) {
  if (!mapping) return 'none'
  if (mapping.client === pcIp) return 'pc'
  if (
    opening &&
    mapping.client === opening.client &&
    mapping.description === PORT_MAPPING_DESCRIPTION
  )
    return 'pc-before'
  return 'other'
}

/**
 * What the upkeep does with the app's `opening` at `nowMs`, given the router's forwarding of its port
 * (`mapping`), this computer's address on the router's network (`pcIp`) and the port the node listens on now
 * (`nodePort`, null when unknown; the node moves to the next port after 2 minutes without peers): the router's
 * lease is the time left to the user's end, so that the router closes it by itself; a router that keeps it
 * shorter gets it again near its end, never during a validation unless it would end first (`validationRuns`);
 * `inboundSinceChange` is null when unknown. One of 'nothing', 'close', 'forget', 'move', 'open', 'renew',
 * 'retry'.
 */
function upkeepAction({
  opening,
  mapping,
  pcIp,
  nodePort,
  nowMs,
  validationRuns,
  inboundSinceChange,
}) {
  const owner = mappingOwner(mapping, pcIp, opening)
  if (nowMs >= opening.endMs) return owner === 'other' ? 'forget' : 'close'
  if (nodePort != null && nodePort !== opening.port) return 'move'
  if (owner === 'other') return 'nothing'
  if (owner === 'none' || owner === 'pc-before') return 'open'
  const lease = mapping.leaseSeconds
  const routerEndsFirst =
    lease > 0 && nowMs + lease * 1000 < opening.endMs - 60 * 1000
  if (
    routerEndsFirst &&
    lease < RENEW_BEFORE_SECONDS &&
    (!validationRuns || lease < 180)
  )
    return 'renew'
  if (
    !opening.retried &&
    nowMs - opening.changedAtMs >= RETRY_AFTER_MS &&
    inboundSinceChange === 0
  )
    return 'retry'
  return 'nothing'
}

/** The node's IPFS port from `net_ipfsAddress` (`/ip4/0.0.0.0/tcp/50506/ipfs/<peer id>`), or null. */
function ipfsAddressPort(address) {
  const match = /\/tcp\/(\d+)(\/|$)/.exec(String(address ?? ''))
  const port = match ? Number(match[1]) : NaN
  return port >= 1 && port <= 65535 ? port : null
}

const INBOUND_PEER =
  /\[(\d\d-\d\d\|\d\d:\d\d:\d\d)\.\d+\] Peer connected .*inbound=true/

/** A time as the node's log writes it: UTC month, day and time (`INFO [10-05|17:22:51.346] ...`). */
function logTime(ms) {
  const d = new Date(ms)
  const two = (n) => String(n).padStart(2, '0')
  return `${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}|${two(
    d.getUTCHours()
  )}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`
}

/**
 * How many Idena peers connected to this computer from outside (`inbound=true`) in `logTail` (the end of the
 * node's log) from `sinceMs` to `nowMs`. The log has no year: over New Year the window wraps.
 */
function inboundPeersSince(logTail, sinceMs, nowMs) {
  const from = logTime(sinceMs)
  const to = logTime(nowMs + 60 * 1000)
  return String(logTail)
    .split('\n')
    .filter((line) => {
      const time = INBOUND_PEER.exec(line)?.[1]
      if (!time) return false
      return from <= to
        ? time >= from && time <= to
        : time >= from || time <= to
    }).length
}

module.exports = {
  PORT_MAPPING_DESCRIPTION,
  MAX_STANDARD_LEASE_SECONDS,
  SSDP_SEARCH_TARGETS,
  SSDP_ROOT_DEVICE,
  DEVICE_NAME_MAX,
  UPNP_NO_SUCH_ENTRY,
  UPNP_CONFLICT,
  UPNP_ONLY_PERMANENT_LEASES,
  RETRY_AFTER_MS,
  PORT_DURATIONS,
  durationEnd,
  ssdpSearch,
  isLocalNetworkHost,
  parseSsdp,
  parseGateway,
  parseDeviceName,
  cleanGateway,
  soapEnvelope,
  parseSoap,
  portArgs,
  addPortMappingArgs,
  portMapping,
  cleanOpening,
  leaseSeconds,
  mappingOwner,
  upkeepAction,
  ipfsAddressPort,
  inboundPeersSince,
}
