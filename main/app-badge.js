// The Social news on the app's icons while its window is closed to the tray, as the phone app counts them on its
// icon: the count on the dock (macOS) or the launcher (Linux, where the desktop supports it), a dot on the
// taskbar button (Windows), and a dot on the tray icon with the count in its tooltip everywhere.

/** The dot's color, as the sidebar's count badges (red.500). */
const DOT = {r: 0xff, g: 0x66, b: 0x66}

/** A count the renderer sent, as a whole number from 0, or null when it is not one. */
function badgeCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1e6 ? value : null
}

/** The dock's text for `count`: none at 0, as the sidebar shows it above 99. */
function badgeText(count) {
  if (!count) return ''
  return count > 99 ? '99+' : String(count)
}

/**
 * A copy of the BGRA `bitmap` (`width` x `height` pixels) with a dot in its top-right corner, `fraction` of the
 * smaller side across (big enough to see on the tray's tiny icon), at least 4 pixels.
 */
function withDot(bitmap, width, height, {fraction = 0.44} = {}) {
  const out = Buffer.from(bitmap)
  const radius = Math.max(2, (Math.min(width, height) * fraction) / 2)
  const cx = width - radius
  const cy = radius
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * width + x) * 4
        out[i] = DOT.b
        out[i + 1] = DOT.g
        out[i + 2] = DOT.r
        out[i + 3] = 0xff
      }
    }
  }
  return out
}

/** `image` (an Electron NativeImage) with the dot, at its own resolution. */
function dottedImage(nativeImage, image) {
  const {width, height} = image.getSize()
  const bitmap = image.toBitmap()
  const scaleFactor = Math.sqrt(bitmap.length / 4 / (width * height)) || 1
  const pixels = {
    width: Math.round(width * scaleFactor),
    height: Math.round(height * scaleFactor),
  }
  return nativeImage.createFromBitmap(
    withDot(bitmap, pixels.width, pixels.height),
    {...pixels, scaleFactor}
  )
}

/** The dot alone, for the Windows taskbar button's overlay (16 x 16). */
function dotImage(nativeImage) {
  const size = 16
  return nativeImage.createFromBitmap(
    withDot(Buffer.alloc(size * size * 4), size, size, {fraction: 1}),
    {width: size, height: size}
  )
}

/**
 * Shows the count on the icons: `tray()` and `window()` the current tray and main window (or null),
 * `trayImagePath()` the tray's plain icon, `t` the app's translations.
 */
function createAppBadge({
  app,
  nativeImage,
  tray,
  window,
  trayImagePath,
  t,
  platform = process.platform,
}) {
  let count = 0

  function refresh() {
    const text = badgeText(count)
    const currentTray = tray()
    if (currentTray) {
      const plain = nativeImage.createFromPath(trayImagePath())
      currentTray.setImage(count > 0 ? dottedImage(nativeImage, plain) : plain)
      currentTray.setToolTip(
        count > 0
          ? `Idena · ${t('{{count}} Social news', {count: text})}`
          : 'Idena'
      )
    }
    if (platform === 'darwin') {
      app.dock?.setBadge(text)
    } else if (platform === 'win32') {
      const win = window()
      if (win && !win.isDestroyed()) {
        win.setOverlayIcon(
          count > 0 ? dotImage(nativeImage) : null,
          count > 0 ? t('{{count}} Social news', {count: text}) : ''
        )
      }
    } else {
      // Unity's launcher API (Ubuntu's dock, KDE): ignored where the desktop has none.
      app.setBadgeCount(count)
    }
  }

  return {
    /** The renderer's count; anything else is dropped. */
    set(value) {
      const next = badgeCount(value)
      if (next === null || next === count) return
      count = next
      refresh()
    },
    /** Draws the icons again (a new tray image, a new window). */
    refresh,
  }
}

module.exports = {
  badgeCount,
  badgeText,
  createAppBadge,
  withDot,
}
