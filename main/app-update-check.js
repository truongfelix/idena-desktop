const semver = require('semver')

// The app's own update check, the same on every system: GitHub's latest published release of this repository (a
// draft or a pre-release is never "latest"). The app only tells of a newer version, and its button opens the
// release page; it downloads and installs nothing by itself.
const LATEST_RELEASE_API =
  'https://api.github.com/repos/truongfelix/idena-desktop/releases/latest'
const LATEST_RELEASE_PAGE =
  'https://github.com/truongfelix/idena-desktop/releases/latest'

// The release's tag when it is a published release newer than appVersion, otherwise null.
function newerReleaseTag(release, appVersion) {
  if (!release || release.draft || release.prerelease) return null
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  const version = semver.clean(tag)
  if (!version || !semver.valid(appVersion)) return null
  return semver.gt(version, appVersion) ? tag : null
}

module.exports = {LATEST_RELEASE_API, LATEST_RELEASE_PAGE, newerReleaseTag}
