import {loadPersistentState, persistState} from '../../shared/utils/persist'

// Idena Connect (B-318): the websites this computer signed in to with Idena (dna://signin), kept on this computer
// only. A site is the origin that receives the signature, the link's authentication_endpoint: the callback and the
// nonce endpoint are only named by the link, and may be another host's.

/** The origin of an http(s) URL ("https://example.com"), null for anything else. */
function webOrigin(url) {
  try {
    const {protocol, origin} = new URL(url)
    return ['https:', 'http:'].includes(protocol) ? origin : null
  } catch {
    return null
  }
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

// The second-level names under which a country's sites register (example.co.uk): the site is then three labels.
const SECOND_LEVELS = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'])

/**
 * The site a host belongs to, for the return-page warning: an IP address or a one-label host as it is, else its last
 * two labels, or three under a country's second level (shop.co.uk). A rule of thumb, not the public suffix list: the
 * warning errs towards showing.
 */
export function siteOfHost(host) {
  const name = String(host).replace(/:\d+$/, '').toLowerCase()
  if (/^[\d.]+$/.test(name) || name.startsWith('[')) return name
  const labels = name.split('.')
  if (labels.length < 3) return name
  const n =
    labels[labels.length - 1].length === 2 &&
    SECOND_LEVELS.has(labels[labels.length - 2])
      ? 3
      : 2
  return labels.slice(-n).join('.')
}

/**
 * The site a sign-in link signs in to: `site` (the origin of its authentication endpoint), its `host`, `website`
 * (the host of its http(s) callback, the page the person comes from; null for another callback), `nonceHost`: the
 * host of its nonce endpoint when it is not `host` (the code is then asked of one host and its signature sent to
 * another, which the dialog warns about), `returnHost`: the callback's host when it belongs to another site than
 * `host` (the person signs in to `host` and goes on to another site, which the dialog warns about: a page could
 * relay another site's endpoints; www. and api. of one site are common and show none), and
 * `disconnectEndpoint`: the link's disconnect_endpoint when it is on `site`, else null.
 */
export function signInSite({
  authenticationEndpoint,
  nonceEndpoint,
  callbackUrl,
  disconnectEndpoint,
}) {
  const site = webOrigin(authenticationEndpoint)
  const host = site ? hostOf(site) : null
  const nonce = nonceEndpoint ? hostOf(nonceEndpoint) : null
  return {
    site,
    host,
    website: webOrigin(callbackUrl) ? hostOf(callbackUrl) : null,
    nonceHost: nonce && nonce !== host ? nonce : null,
    returnHost:
      host &&
      webOrigin(callbackUrl) &&
      siteOfHost(hostOf(callbackUrl)) !== siteOfHost(host)
        ? hostOf(callbackUrl)
        : null,
    disconnectEndpoint:
      site && webOrigin(disconnectEndpoint) === site
        ? disconnectEndpoint
        : null,
  }
}

/**
 * The text an account signs to disconnect from `site` (an origin) at `time` (Unix seconds): the site checks that it
 * names its own origin and a time within a few minutes of its clock, so the signature serves no other site or day.
 */
export const disconnectMessage = (site, time) => `disconnect-${site}-${time}`

const sameEntry = (entry, site, address) =>
  entry.site === site && entry.address === String(address).toLowerCase()

/** The entry of `site` for `address` in `sites`, or null. */
export function findSite(sites, site, address) {
  return sites.find((entry) => sameEntry(entry, site, address)) || null
}

/**
 * `sites` with a sign-in to `site` by `address` at `now` (ms), from the page of `website` (a host, or null), with
 * the site's `disconnectEndpoint` (or null): the entry's last time, count, website and endpoint updated, or a new
 * entry; the latest first.
 */
export function recordSignIn(
  sites,
  {site, address, website = null, disconnectEndpoint = null},
  now
) {
  const known = findSite(sites, site, address)
  const entry = known
    ? {
        ...known,
        website,
        disconnectEndpoint,
        lastAt: now,
        count: known.count + 1,
      }
    : {
        site,
        address: String(address).toLowerCase(),
        website,
        disconnectEndpoint,
        firstAt: now,
        lastAt: now,
        count: 1,
      }
  return [entry, ...sites.filter((other) => other !== known)].sort(
    (a, b) => b.lastAt - a.lastAt
  )
}

/** `sites` without the entry of `site` for `address`. */
export function forgetSite(sites, site, address) {
  return sites.filter((entry) => !sameEntry(entry, site, address))
}

const isEntry = (entry) =>
  Boolean(entry) &&
  typeof entry.site === 'string' &&
  webOrigin(entry.site) === entry.site &&
  typeof entry.address === 'string' &&
  (entry.website == null || typeof entry.website === 'string') &&
  Number.isFinite(entry.firstAt) &&
  Number.isFinite(entry.lastAt) &&
  Number.isFinite(entry.count)

/** The saved sites (only this file writes them: {sites: [...]}), the entries it cannot read left out. */
export function readConnectedSites(state) {
  const sites = state?.sites
  if (!Array.isArray(sites)) return []
  // A disconnect endpoint off the entry's site is dropped, the entry kept.
  return sites
    .filter(isEntry)
    .map((entry) =>
      entry.disconnectEndpoint == null ||
      webOrigin(entry.disconnectEndpoint) === entry.site
        ? entry
        : {...entry, disconnectEndpoint: null}
    )
}

/** The window event sent once the list is saved, for a page that shows it. */
export const CONNECTED_SITES_EVENT = 'idena-connected-sites'

// The store 'connectedSites', named in each call: main/safe-store-bridge.test.js reads the names from the calls.
export function loadConnectedSites() {
  return readConnectedSites(loadPersistentState('connectedSites'))
}

export function saveConnectedSites(sites) {
  persistState('connectedSites', {sites})
  window.dispatchEvent(new Event(CONNECTED_SITES_EVENT))
}
