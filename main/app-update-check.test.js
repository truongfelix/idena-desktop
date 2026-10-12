const {
  LATEST_RELEASE_API,
  LATEST_RELEASE_PAGE,
  newerReleaseTag,
} = require('./app-update-check')

describe('app update check', () => {
  it('reads and opens the latest release of this repository', () => {
    expect(LATEST_RELEASE_API).toBe(
      'https://api.github.com/repos/truongfelix/idena-desktop/releases/latest'
    )
    expect(LATEST_RELEASE_PAGE).toBe(
      'https://github.com/truongfelix/idena-desktop/releases/latest'
    )
  })

  it('offers a newer published release', () => {
    expect(newerReleaseTag({tag_name: 'v0.41.0'}, '0.40.0')).toBe('v0.41.0')
    expect(newerReleaseTag({tag_name: '0.40.1'}, '0.40.0')).toBe('0.40.1')
  })

  it('offers the release to a beta of the same version', () => {
    expect(newerReleaseTag({tag_name: 'v0.40.0'}, '0.40.0-beta.1')).toBe(
      'v0.40.0'
    )
  })

  it('offers nothing for the same or an older version', () => {
    expect(newerReleaseTag({tag_name: 'v0.40.0'}, '0.40.0')).toBeNull()
    expect(newerReleaseTag({tag_name: 'v0.39.1'}, '0.40.0')).toBeNull()
  })

  it('offers no draft and no pre-release', () => {
    expect(
      newerReleaseTag({tag_name: 'v0.41.0', draft: true}, '0.40.0')
    ).toBeNull()
    expect(
      newerReleaseTag({tag_name: 'v0.41.0-beta.1', prerelease: true}, '0.40.0')
    ).toBeNull()
  })

  it('offers nothing for an answer it cannot read', () => {
    expect(newerReleaseTag(null, '0.40.0')).toBeNull()
    expect(newerReleaseTag({}, '0.40.0')).toBeNull()
    expect(newerReleaseTag({tag_name: 'latest'}, '0.40.0')).toBeNull()
    expect(newerReleaseTag({tag_name: 41}, '0.40.0')).toBeNull()
    expect(newerReleaseTag({tag_name: 'v0.41.0'}, 'dev')).toBeNull()
  })
})
