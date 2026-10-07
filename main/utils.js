const {persistZoomLevel} = require('./stores/settings')

function promiseTimeout(ms, promise) {
  const timeout = new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id)
      return reject(new Error(`Timed out in ${ms}ms.`))
    }, ms)
  })

  return Promise.race([promise, timeout])
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// A GitHub API answer "Not Found": for /releases/latest, the repository has no published release yet.
function isNotFoundError(error) {
  return error?.response?.status === 404
}

// The page's zoom range, also Ctrl+wheel's (renderer/shared/components/layout.js).
const MIN_ZOOM_LEVEL = -5
const MAX_ZOOM_LEVEL = 5

// Sets the window's zoom level within the range and saves it. A menu item's click handler gets no window
// when none has the focus (on macOS the menu stays with the main window hidden): nothing to zoom then.
function setZoomLevel(window, nextLevel) {
  const contents = window && window.webContents
  if (!contents || contents.isDestroyed()) return
  const level = Math.min(
    Math.max(MIN_ZOOM_LEVEL, nextLevel(contents.zoomLevel)),
    MAX_ZOOM_LEVEL
  )
  contents.zoomLevel = level
  persistZoomLevel(level)
}

module.exports = {
  promiseTimeout,
  sleep,
  isNotFoundError,
  zoomIn(window) {
    setZoomLevel(window, (level) => level + 1)
  },
  zoomOut(window) {
    setZoomLevel(window, (level) => level - 1)
  },
  resetZoom(window) {
    setZoomLevel(window, () => 0)
  },
}
