const {
  _internals: {
    dedupeSearchResults,
    extractDuckDuckGoVqd,
    normalizeImageSearchQuery,
    normalizeImageSearchResult,
    normalizeImageSearchUrl,
    searchDuckDuckGoImages,
    searchOpenverseImages,
    searchWikimediaImages,
  },
} = require('./image-search')

const USER_AGENT_PATTERN =
  /^IdenaDesktop\/\S+ \(https:\/\/github\.com\/truongfelix\/idena-desktop\)$/

describe('image search helpers', () => {
  test('extracts current DuckDuckGo vqd token shapes', () => {
    expect(extractDuckDuckGoVqd('vqd="abc-123_ABC.0"')).toBe('abc-123_ABC.0')
    expect(
      extractDuckDuckGoVqd('https://duckduckgo.com/i.js?vqd=xyz&x=1')
    ).toBe('xyz')
    expect(extractDuckDuckGoVqd('{"vqd":"token_42"}')).toBe('token_42')
  })

  test('rejects unsafe or unusable image URLs', () => {
    expect(normalizeImageSearchUrl('https://example.com/image.png')).toBe(
      'https://example.com/image.png'
    )
    expect(normalizeImageSearchUrl('http://example.com/image.png')).toBeNull()
    expect(
      normalizeImageSearchUrl('https://user:pass@example.com/image.png')
    ).toBeNull()
    expect(normalizeImageSearchUrl('not a url')).toBeNull()
  })

  test('normalizes provider result shapes', () => {
    expect(
      normalizeImageSearchResult({
        url: 'https://example.com/full.jpg',
        thumbnail_url: 'https://example.com/thumb.jpg',
      })
    ).toEqual({
      image: 'https://example.com/full.jpg',
      thumbnail: 'https://example.com/thumb.jpg',
    })
  })

  test('normalizes queries and dedupes by image URL', () => {
    expect(normalizeImageSearchQuery('  cat\n  sitting\toutside  ')).toBe(
      'cat sitting outside'
    )
    expect(
      dedupeSearchResults([
        {
          image: 'https://example.com/a.jpg',
          thumbnail: 'https://example.com/a-thumb.jpg',
        },
        {
          image: 'https://example.com/a.jpg',
          thumbnail: 'https://example.com/other-thumb.jpg',
        },
        {
          image: 'https://example.com/b.jpg',
          thumbnail: 'https://example.com/b-thumb.jpg',
        },
      ])
    ).toEqual([
      {
        image: 'https://example.com/a.jpg',
        thumbnail: 'https://example.com/a-thumb.jpg',
      },
      {
        image: 'https://example.com/b.jpg',
        thumbnail: 'https://example.com/b-thumb.jpg',
      },
    ])
  })

  test('uses the DuckDuckGo landing token for a bounded image request', async () => {
    const requestText = jest
      .fn()
      .mockResolvedValueOnce('<html><script>vqd="token-123"</script></html>')
      .mockResolvedValueOnce(
        JSON.stringify({
          results: [
            {
              image: 'https://images.example/full.jpg',
              thumbnail: 'https://images.example/thumb.jpg',
            },
            {
              image: 'http://images.example/insecure.jpg',
              thumbnail: 'https://images.example/insecure-thumb.jpg',
            },
          ],
        })
      )

    await expect(
      searchDuckDuckGoImages('Idena cryptocurrency', {requestText})
    ).resolves.toEqual([
      {
        image: 'https://images.example/full.jpg',
        thumbnail: 'https://images.example/thumb.jpg',
      },
    ])

    expect(requestText).toHaveBeenCalledTimes(2)
    const [landingUrl, landingOptions] = requestText.mock.calls[0]
    expect(landingUrl.origin).toBe('https://duckduckgo.com')
    expect(landingUrl.pathname).toBe('/')
    expect(landingUrl.searchParams.get('q')).toBe('Idena cryptocurrency')
    expect(landingOptions).toEqual({
      timeoutMs: 5000,
      maxBytes: 512 * 1024,
    })

    const [apiUrl, apiOptions] = requestText.mock.calls[1]
    expect(apiUrl.href.startsWith('https://duckduckgo.com/i.js?')).toBe(true)
    expect(apiUrl.searchParams.get('q')).toBe('Idena cryptocurrency')
    expect(apiUrl.searchParams.get('vqd')).toBe('token-123')
    expect(apiOptions.headers.referer).toBe(landingUrl.href)
  })

  test('asks Openverse for at most 20 pictures, with a client name', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        results: [
          {
            url: 'https://images.example/full.jpg',
            thumbnail: 'https://api.openverse.example/thumb/',
          },
        ],
      },
    })

    await expect(searchOpenverseImages('cat', {get})).resolves.toEqual([
      {
        image: 'https://images.example/full.jpg',
        thumbnail: 'https://api.openverse.example/thumb/',
      },
    ])

    const [url, options] = get.mock.calls[0]
    expect(url).toBe('https://api.openverse.org/v1/images/')
    expect(options.params).toEqual({q: 'cat', page_size: 20})
    expect(options.headers['user-agent']).toMatch(USER_AGENT_PATTERN)
  })

  test('asks Wikimedia with a client name and contact', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        query: {
          pages: {
            1: {
              imageinfo: [
                {
                  url: 'https://upload.example/cat.jpg',
                  thumburl: 'https://upload.example/320px-cat.jpg',
                },
              ],
            },
          },
        },
      },
    })

    await expect(searchWikimediaImages('cat', {get})).resolves.toEqual([
      {
        image: 'https://upload.example/cat.jpg',
        thumbnail: 'https://upload.example/320px-cat.jpg',
      },
    ])

    const [url, options] = get.mock.calls[0]
    expect(url).toBe('https://commons.wikimedia.org/w/api.php')
    expect(options.params.gsrsearch).toBe('cat')
    expect(options.headers['user-agent']).toMatch(USER_AGENT_PATTERN)
  })

  test('a refused source gives no pictures instead of an error', async () => {
    const get = jest.fn().mockRejectedValue(new Error('HTTP 403'))
    const logger = {warn: jest.fn()}

    await expect(searchWikimediaImages('cat', {get, logger})).resolves.toEqual(
      []
    )
    await expect(searchOpenverseImages('cat', {get, logger})).resolves.toEqual(
      []
    )
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })
})
