const semver = require('semver')

// The app's own release check, the same on every system and as the phone app's (ruling Q-50): off until the user
// turns it on; then GitHub's list of this repository's releases, at the start and once a day. A newer release is
// shown with its note, and its button opens the release page: the app downloads and installs nothing by itself.
const RELEASES_API =
  'https://api.github.com/repos/truongfelix/idena-desktop/releases?per_page=30'
const RELEASES_PAGE = 'https://github.com/truongfelix/idena-desktop/releases'

/** How often the check runs while it is on. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** The longest release note passed on to the window. */
const MAX_NOTES_LENGTH = 20000

const versionOf = (release) =>
  typeof release?.tag_name === 'string' ? semver.clean(release.tag_name) : null

/**
 * The newest published release in `releases` (GitHub's list) that is newer than `appVersion`, as {tag, version,
 * name, notes, url}, or null. Pre-releases count only while the repository has no stable release.
 */
function newerRelease(releases, appVersion) {
  if (!Array.isArray(releases) || !semver.valid(appVersion)) return null
  const published = releases.filter(
    (release) => release && !release.draft && versionOf(release)
  )
  const hasStable = published.some((release) => !release.prerelease)
  const candidates = published.filter(
    (release) =>
      (!hasStable || !release.prerelease) &&
      semver.gt(versionOf(release), appVersion)
  )
  if (candidates.length === 0) return null
  const newest = candidates.reduce((a, b) =>
    semver.gt(versionOf(b), versionOf(a)) ? b : a
  )
  const tag = newest.tag_name
  return {
    tag,
    version: versionOf(newest),
    name: typeof newest.name === 'string' ? newest.name : tag,
    notes:
      typeof newest.body === 'string'
        ? newest.body.slice(0, MAX_NOTES_LENGTH)
        : '',
    // Built from the tag, not taken from the answer: the button opens only this repository's pages.
    url: `${RELEASES_PAGE}/tag/${encodeURIComponent(tag)}`,
  }
}

/**
 * Runs the check while it is on: `fetchReleases()` GitHub's list, `onRelease(release)` for a newer release
 * (main/index.js sends it to the window).
 */
function createReleaseCheck({
  fetchReleases,
  appVersion,
  onRelease,
  logger,
  intervalMs = CHECK_INTERVAL_MS,
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  let timer = null
  let latest = null

  async function check() {
    try {
      const release = newerRelease(await fetchReleases(), appVersion)
      if (release) {
        latest = release
        onRelease(release)
      }
    } catch (e) {
      logger.error('error while checking for a new release', e.toString())
    }
  }

  return {
    /** The user's setting: on starts the checks (one at once), off stops them. */
    setEnabled(enabled) {
      if (enabled && !timer) {
        timer = setTimer(check, intervalMs)
        return check()
      }
      if (!enabled && timer) {
        clearTimer(timer)
        timer = null
      }
      return Promise.resolve()
    },
    /** The page of the last newer release found, or the releases page. */
    get pageUrl() {
      return latest?.url ?? RELEASES_PAGE
    },
  }
}

module.exports = {
  RELEASES_API,
  RELEASES_PAGE,
  CHECK_INTERVAL_MS,
  newerRelease,
  createReleaseCheck,
}
