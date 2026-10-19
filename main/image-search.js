const axios = require('axios')
const {version} = require('../package.json')

const SOURCE_TIMEOUT_MS = 8000
const MAX_QUERY_LENGTH = 160
// Openverse answers anonymous requests of up to 20 results; above that it wants an account (HTTP 401).
const OPENVERSE_PAGE_SIZE = 20
// Wikimedia refuses requests without a client name and a contact (its User-Agent policy, HTTP 403).
const IMAGE_SEARCH_USER_AGENT = `IdenaDesktop/${version} (https://github.com/truongfelix/idena-desktop)`

function logWarn(logger, message, error) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(message, error ? error.toString() : undefined)
  }
}

function normalizeImageSearchUrl(value) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.length > 4096) return null

  try {
    const parsedUrl = new URL(normalized)
    if (parsedUrl.protocol !== 'https:') return null
    if (parsedUrl.username || parsedUrl.password) return null
    return parsedUrl.href
  } catch {
    return null
  }
}

function normalizeImageSearchResult(item) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const image = normalizeImageSearchUrl(
    item.image ||
      item.url ||
      item.imageUrl ||
      item.image_url ||
      item.full ||
      item.raw ||
      null
  )

  const thumbnail = normalizeImageSearchUrl(
    item.thumbnail ||
      item.thumb ||
      item.thumbnailUrl ||
      item.thumbnail_url ||
      item.preview ||
      item.small ||
      image
  )

  if (!image || !thumbnail) {
    return null
  }

  return {image, thumbnail}
}

function withSearchSourceTimeout(
  promise,
  label,
  {logger, timeoutMs = SOURCE_TIMEOUT_MS} = {}
) {
  let timeout = null

  return Promise.race([
    promise,
    new Promise((resolve) => {
      timeout = setTimeout(() => {
        logWarn(logger, `${label} timed out after ${timeoutMs}ms`)
        resolve([])
      }, timeoutMs)
    }),
  ])
    .catch((error) => {
      logWarn(logger, `${label} failed`, error)
      return []
    })
    .finally(() => {
      if (timeout) {
        clearTimeout(timeout)
      }
    })
}

async function searchOpenverseImages(query, {logger, get = axios.get} = {}) {
  try {
    const {data} = await get('https://api.openverse.org/v1/images/', {
      params: {
        q: query,
        page_size: OPENVERSE_PAGE_SIZE,
      },
      headers: {'user-agent': IMAGE_SEARCH_USER_AGENT},
      timeout: 12000,
    })

    const results = Array.isArray(data && data.results) ? data.results : []

    return results
      .map((item) =>
        normalizeImageSearchResult({
          image: item && item.url,
          thumbnail:
            (item && (item.thumbnail || item.thumbnail_url)) ||
            (item && item.url),
        })
      )
      .filter(Boolean)
  } catch (error) {
    logWarn(logger, 'openverse image search failed', error)
    return []
  }
}

async function searchWikimediaImages(query, {logger, get = axios.get} = {}) {
  try {
    const {data} = await get('https://commons.wikimedia.org/w/api.php', {
      params: {
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: query,
        gsrnamespace: 6,
        gsrlimit: 30,
        prop: 'imageinfo',
        iiprop: 'url',
        iiurlwidth: 320,
        origin: '*',
      },
      headers: {'user-agent': IMAGE_SEARCH_USER_AGENT},
      timeout: 12000,
    })

    const pages = data && data.query && data.query.pages
    const list = pages && typeof pages === 'object' ? Object.values(pages) : []

    return list
      .map((item) => {
        const imageInfo = Array.isArray(item && item.imageinfo)
          ? item.imageinfo[0]
          : null
        return normalizeImageSearchResult({
          image: imageInfo && imageInfo.url,
          thumbnail:
            (imageInfo && (imageInfo.thumburl || imageInfo.url)) || null,
        })
      })
      .filter(Boolean)
  } catch (error) {
    logWarn(logger, 'wikimedia image search failed', error)
    return []
  }
}

function dedupeSearchResults(items) {
  const seen = new Set()
  const result = []

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const image = String(item.image || '').trim()
    const thumbnail = String(item.thumbnail || '').trim()
    if (!image || !thumbnail) return
    if (seen.has(image)) return
    seen.add(image)
    result.push({image, thumbnail})
  })

  return result
}

function normalizeImageSearchQuery(query) {
  return Array.from(String(query || ''))
    .map((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
}

// The sources, by the name the renderer asks for one of them with (B-33: each one's pictures shown as it answers).
const IMAGE_SOURCES = {
  openverse: searchOpenverseImages,
  wikimedia: searchWikimediaImages,
}

const MAX_RESULTS = 64

/** The pictures `source` (a name of IMAGE_SOURCES) finds for `query`: [] when it fails, times out or is unknown. */
async function searchImageSource(
  query,
  source,
  {logger, sources = IMAGE_SOURCES, timeoutMs} = {}
) {
  const normalizedQuery = normalizeImageSearchQuery(query)
  const search = Object.prototype.hasOwnProperty.call(sources, source)
    ? sources[source]
    : null
  if (!normalizedQuery || !search) return []

  const results = await withSearchSourceTimeout(
    search(normalizedQuery, {logger}),
    `${source} image search`,
    {logger, timeoutMs}
  )
  return dedupeSearchResults(results).slice(0, MAX_RESULTS)
}

/** The pictures every source finds for `query`, once all have answered. */
async function searchImages(query, {logger, sources = IMAGE_SOURCES} = {}) {
  const found = await Promise.all(
    Object.keys(sources).map((source) =>
      searchImageSource(query, source, {logger, sources})
    )
  )
  return dedupeSearchResults(found.flat()).slice(0, MAX_RESULTS)
}

module.exports = {
  IMAGE_SOURCE_NAMES: Object.keys(IMAGE_SOURCES),
  searchImageSource,
  searchImages,
  _internals: {
    dedupeSearchResults,
    normalizeImageSearchQuery,
    normalizeImageSearchResult,
    normalizeImageSearchUrl,
    searchOpenverseImages,
    searchWikimediaImages,
  },
}
