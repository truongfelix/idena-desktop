const {
  RELEASES_API,
  RELEASES_PAGE,
  createReleaseCheck,
  newerRelease,
} = require('./app-update-check')

const release = (tag, more = {}) => ({
  tag_name: tag,
  name: `Idena ${tag}`,
  body: `What's new in ${tag}`,
  html_url: `https://github.com/truongfelix/idena-desktop/releases/tag/${tag}`,
  ...more,
})
const beta = (tag) => release(tag, {prerelease: true})

describe('the release check', () => {
  it('reads the releases of this repository', () => {
    expect(RELEASES_API).toBe(
      'https://api.github.com/repos/truongfelix/idena-desktop/releases?per_page=30'
    )
  })

  it('offers the newest beta while there is no stable release', () => {
    const releases = [
      beta('v0.40.0-beta.3'),
      beta('v0.40.0-beta.4'),
      beta('v0.40.0-beta.2'),
    ]
    expect(newerRelease(releases, '0.40.0-beta.3')).toEqual({
      tag: 'v0.40.0-beta.4',
      version: '0.40.0-beta.4',
      name: 'Idena v0.40.0-beta.4',
      notes: "What's new in v0.40.0-beta.4",
      url: 'https://github.com/truongfelix/idena-desktop/releases/tag/v0.40.0-beta.4',
    })
  })

  it('offers only stable releases once there is one', () => {
    const releases = [release('v0.40.0'), beta('v0.41.0-beta.1')]
    expect(newerRelease(releases, '0.40.0-beta.4').tag).toBe('v0.40.0')
    expect(newerRelease(releases, '0.40.0')).toBeNull()
  })

  it('offers nothing for the same or an older version, nor a draft', () => {
    expect(newerRelease([beta('v0.40.0-beta.3')], '0.40.0-beta.3')).toBeNull()
    expect(newerRelease([release('v0.39.1')], '0.40.0')).toBeNull()
    expect(
      newerRelease([release('v0.41.0', {draft: true})], '0.40.0')
    ).toBeNull()
  })

  it('opens only a page of this repository', () => {
    const offered = newerRelease(
      [release('v0.41.0', {html_url: 'https://example.com/x'})],
      '0.40.0'
    )
    expect(offered.url).toBe(`${RELEASES_PAGE}/tag/v0.41.0`)
  })

  it('offers nothing for an answer it cannot read', () => {
    expect(newerRelease(null, '0.40.0')).toBeNull()
    expect(newerRelease({}, '0.40.0')).toBeNull()
    expect(newerRelease([null, {}, {tag_name: 41}], '0.40.0')).toBeNull()
    expect(newerRelease([{tag_name: 'latest'}], '0.40.0')).toBeNull()
    expect(newerRelease([release('v0.41.0')], 'dev')).toBeNull()
  })

  it('keeps a missing note empty and a long one short', () => {
    expect(
      newerRelease([release('v0.41.0', {body: null})], '0.40.0').notes
    ).toBe('')
    expect(
      newerRelease([release('v0.41.0', {body: 'x'.repeat(30000)})], '0.40.0')
        .notes
    ).toHaveLength(20000)
  })
})

describe('the release check while on or off', () => {
  function setup(releases = [beta('v0.40.0-beta.4')]) {
    const timers = []
    const fetchReleases = jest.fn(async () => releases)
    const onRelease = jest.fn()
    const check = createReleaseCheck({
      fetchReleases,
      appVersion: '0.40.0-beta.3',
      onRelease,
      logger: {error: jest.fn()},
      setTimer: (fn, ms) => {
        timers.push({fn, ms, cleared: false})
        return timers.length
      },
      clearTimer: (id) => {
        timers[id - 1].cleared = true
      },
    })
    return {check, fetchReleases, onRelease, timers}
  }

  it('sends nothing to GitHub while off', async () => {
    const {check, fetchReleases, timers} = setup()
    await check.setEnabled(false)
    expect(fetchReleases).not.toHaveBeenCalled()
    expect(timers).toEqual([])
    expect(check.pageUrl).toBe(RELEASES_PAGE)
  })

  it('checks at once when turned on, then once a day', async () => {
    const {check, fetchReleases, onRelease, timers} = setup()
    await check.setEnabled(true)
    expect(fetchReleases).toHaveBeenCalledTimes(1)
    expect(onRelease.mock.calls[0][0].tag).toBe('v0.40.0-beta.4')
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(24 * 60 * 60 * 1000)
    expect(check.pageUrl).toBe(`${RELEASES_PAGE}/tag/v0.40.0-beta.4`)
    // On again: no second timer, no second check.
    await check.setEnabled(true)
    expect(timers).toHaveLength(1)
    expect(fetchReleases).toHaveBeenCalledTimes(1)
  })

  it('stops when turned off', async () => {
    const {check, timers} = setup()
    await check.setEnabled(true)
    await check.setEnabled(false)
    expect(timers[0].cleared).toBe(true)
  })

  it('tells nothing when no release is newer', async () => {
    const {check, onRelease} = setup([beta('v0.40.0-beta.2')])
    await check.setEnabled(true)
    expect(onRelease).not.toHaveBeenCalled()
  })
})
