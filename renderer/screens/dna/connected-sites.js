import {loadPersistentState, persistState} from '../../shared/utils/persist'

// Idena Connect (B-318): the websites this computer signed in to with Idena (dna://signin), kept on this computer
// only. A site is the origin that receives the signature, the link's authentication_endpoint: the callback and the
// nonce endpoint are only named by the link, and may be another site's.

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

/**
 * The site a sign-in link signs in to: `site` (the origin of its authentication endpoint), its `host`, and
 * `otherHosts`: the hosts of its nonce endpoint and its http(s) callback that are not that host, which the dialog
 * names (a link can show one website and send the signature to another).
 */
export function signInSite({
  authenticationEndpoint,
  nonceEndpoint,
  callbackUrl,
}) {
  const site = webOrigin(authenticationEndpoint)
  const host = site ? hostOf(site) : null
  const others = [nonceEndpoint, webOrigin(callbackUrl) && callbackUrl]
    .map((url) => (url ? hostOf(url) : null))
    .filter((other) => other && other !== host)
  return {site, host, otherHosts: [...new Set(others)]}
}

const sameEntry = (entry, site, address) =>
  entry.site === site && entry.address === String(address).toLowerCase()

/** The entry of `site` for `address` in `sites`, or null. */
export function findSite(sites, site, address) {
  return sites.find((entry) => sameEntry(entry, site, address)) || null
}

/**
 * `sites` with a sign-in to `site` by `address` at `now` (ms): the entry's last time and count updated, or a new
 * entry; the latest first.
 */
export function recordSignIn(sites, {site, address}, now) {
  const known = findSite(sites, site, address)
  const entry = known
    ? {...known, lastAt: now, count: known.count + 1}
    : {
        site,
        address: String(address).toLowerCase(),
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
  Number.isFinite(entry.firstAt) &&
  Number.isFinite(entry.lastAt) &&
  Number.isFinite(entry.count)

/** The saved sites (only this file writes them: {sites: [...]}), the entries it cannot read left out. */
export function readConnectedSites(state) {
  const sites = state?.sites
  return Array.isArray(sites) ? sites.filter(isEntry) : []
}

// The store 'connectedSites', named in each call: main/safe-store-bridge.test.js reads the names from the calls.
export function loadConnectedSites() {
  return readConnectedSites(loadPersistentState('connectedSites'))
}

export function saveConnectedSites(sites) {
  persistState('connectedSites', {sites})
}
