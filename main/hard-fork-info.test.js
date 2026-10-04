const crypto = require('crypto')
const {fetchHardForkInfo, parseHardForkInfo} = require('./hard-fork-info')

const releaseUrl =
  'https://github.com/truongfelix/idena-go/releases/download/v1.2.0/'

const description = {
  version: '1.2.0',
  upgrade: 13,
  changes: ['New flip format', 'Bigger blocks'],
  startActivationDate: '2027-01-10T08:00:00Z',
  endActivationDate: '2027-01-20T00:00:00Z',
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')

describe('parseHardForkInfo', () => {
  it('reads a valid description', () => {
    expect(parseHardForkInfo(JSON.stringify(description), 'v1.2.0')).toEqual({
      version: '1.2.0',
      upgrade: 13,
      changes: ['New flip format', 'Bigger blocks'],
      startActivationDate: '2027-01-10T08:00:00.000Z',
      endActivationDate: '2027-01-20T00:00:00.000Z',
      activated: false,
    })
    expect(
      parseHardForkInfo(
        JSON.stringify({...description, activated: true}),
        '1.2.0'
      ).activated
    ).toBe(true)
  })

  it.each([
    ['another node version', {version: '1.1.0'}],
    ['no upgrade number', {upgrade: undefined}],
    ['a zero upgrade number', {upgrade: 0}],
    ['changes that are not strings', {changes: [1]}],
    ['an empty change', {changes: ['  ']}],
    ['no changes list', {changes: 'New flip format'}],
    ['a bad start date', {startActivationDate: 'soon'}],
    ['a numeric date', {endActivationDate: 1790000000}],
    [
      'an end before the start',
      {endActivationDate: description.startActivationDate},
    ],
    ['an activation flag that is not a boolean', {activated: 'yes'}],
  ])('refuses %s', (_, change) => {
    expect(() =>
      parseHardForkInfo(JSON.stringify({...description, ...change}), '1.2.0')
    ).toThrow()
  })

  it('refuses what is not an object', () => {
    expect(() => parseHardForkInfo('[]', '1.2.0')).toThrow()
    expect(() => parseHardForkInfo('null', '1.2.0')).toThrow()
    expect(() => parseHardForkInfo('{', '1.2.0')).toThrow()
  })
})

describe('fetchHardForkInfo', () => {
  const text = JSON.stringify(description)
  const assets = [
    {name: 'hardfork.json', browser_download_url: `${releaseUrl}hardfork.json`},
    {
      name: 'hardfork.json.sha256',
      browser_download_url: `${releaseUrl}hardfork.json.sha256`,
    },
  ]
  const getFiles = (files) =>
    jest.fn(async (url) => ({data: files[url.slice(releaseUrl.length)]}))

  it('takes a release without a description as no hard fork', async () => {
    const get = jest.fn()
    expect(
      await fetchHardForkInfo({assets: [], version: '1.2.0', get})
    ).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('reads a description that matches its checksum', async () => {
    const get = getFiles({
      'hardfork.json': Buffer.from(text),
      'hardfork.json.sha256': `${sha256(text)}  hardfork.json\n`,
    })
    const info = await fetchHardForkInfo({assets, version: '1.2.0', get})
    expect(info.upgrade).toBe(13)
  })

  it('refuses a description that does not match its checksum', async () => {
    const get = getFiles({
      'hardfork.json': Buffer.from(text.replace('Bigger', 'Smaller')),
      'hardfork.json.sha256': `${sha256(text)}  hardfork.json\n`,
    })
    await expect(
      fetchHardForkInfo({assets, version: '1.2.0', get})
    ).rejects.toThrow('does not match its checksum')
  })

  it('refuses a description without a checksum', async () => {
    await expect(
      fetchHardForkInfo({
        assets: assets.slice(0, 1),
        version: '1.2.0',
        get: jest.fn(),
      })
    ).rejects.toThrow('has no checksum')
  })

  it('refuses a description hosted outside our releases', async () => {
    const get = jest.fn()
    await expect(
      fetchHardForkInfo({
        assets: [
          {
            name: 'hardfork.json',
            browser_download_url: 'https://example.com/hardfork.json',
          },
          {
            ...assets[1],
            browser_download_url: 'https://example.com/hardfork.json.sha256',
          },
        ],
        version: '1.2.0',
        get,
      })
    ).rejects.toThrow('Unsafe')
    expect(get).not.toHaveBeenCalled()
  })
})
