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

// A menu item's click handler gets no window when none has the focus: on macOS the menu stays with the
// main window hidden. Nothing to zoom then.
function zoomableContents(window) {
  const contents = window && window.webContents
  return contents && !contents.isDestroyed() ? contents : null
}

module.exports = {
  promiseTimeout,
  sleep,
  isNotFoundError,
  zoomIn(window) {
    const contents = zoomableContents(window)
    if (!contents) return
    const nextLevel = contents.zoomLevel + 1
    contents.zoomLevel = nextLevel
    persistZoomLevel(nextLevel)
  },
  zoomOut(window) {
    const contents = zoomableContents(window)
    if (!contents) return
    const nextLevel = contents.zoomLevel - 1
    contents.zoomLevel = nextLevel
    persistZoomLevel(nextLevel)
  },
  resetZoom(window) {
    const contents = zoomableContents(window)
    if (!contents) return
    contents.zoomLevel = 0
    persistZoomLevel(0)
  },
}
