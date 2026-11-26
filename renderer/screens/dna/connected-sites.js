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

/** A host for the return-page warning: no port, lower case, no final dot. */
const plainHost = (host) =>
  String(host).replace(/:\d+$/, '').toLowerCase().replace(/\.+$/, '')

/**
 * Whether two hosts are one site for the return-page warning: the same host but for its port or a www. or api. in
 * front, or one a subdomain of the other. Two sites of one hosting service (a.vercel.app, b.vercel.app, and
 * www.vercel.app) or one country (a.co.uk, b.co.uk) are not: the warning errs towards showing.
 */
export function sameSite(a, b) {
  const x = plainHost(a)
  const y = plainHost(b)
  const bare = (host) => host.replace(/^(www|api)\./, '')
  return bare(x) === bare(y) || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)
}

/** The icon beside a site's name: the link's when it is on that site, else the site's favicon.ico. */
function siteFavicon(site, faviconUrl) {
  if (!site) return null
  if (webOrigin(faviconUrl) === site) return faviconUrl
  return new URL('favicon.ico', site).href
}

/**
 * The site a sign-in link signs in to: `site` (the origin of its authentication endpoint), its `host`, `website`
 * (the host of its http(s) callback, the page the person comes from; null for another callback), `nonceHost`: the
 * host of its nonce endpoint when it is not `host` (the code is then asked of one host and its signature sent to
 * another, which the dialog warns about), `returnHost`: the callback's host when it belongs to another site than
 * `host` (the person signs in to `host` and goes on to another site, which the dialog warns about: a page could
 * relay another site's endpoints; www. and api. of one site are common and show none), and
 * `favicon`: the link's favicon_url when it is on `site`, else `site`'s favicon.ico (no other site's icon beside
 * this site's name), and `disconnectEndpoint`: the link's disconnect_endpoint when it is on `site`, else null.
 */
export function signInSite({
  authenticationEndpoint,
  nonceEndpoint,
  callbackUrl,
  disconnectEndpoint,
  faviconUrl,
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
      host && webOrigin(callbackUrl) && !sameSite(hostOf(callbackUrl), host)
        ? hostOf(callbackUrl)
        : null,
    favicon: siteFavicon(site, faviconUrl),
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
