const {badgeCount, badgeText, createAppBadge, withDot} = require('./app-badge')

const pixel = (bitmap, width, x, y) => [
  ...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
]

describe('the app badge', () => {
  it('takes only whole counts from the renderer', () => {
    expect(badgeCount(3)).toBe(3)
    expect(badgeCount(0)).toBe(0)
    expect(badgeCount(-1)).toBeNull()
    expect(badgeCount(1.5)).toBeNull()
    expect(badgeCount('3')).toBeNull()
    expect(badgeCount(undefined)).toBeNull()
  })

  it('writes the count as the sidebar does', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(7)).toBe('7')
    expect(badgeText(100)).toBe('99+')
  })

  it('draws a dot in the top-right corner only', () => {
    const width = 32
    const bitmap = Buffer.alloc(width * width * 4, 0x10)
    const dotted = withDot(bitmap, width, width)
    expect(pixel(dotted, width, 28, 3)).toEqual([0x66, 0x66, 0xff, 0xff])
    expect(pixel(dotted, width, 2, 2)).toEqual([0x10, 0x10, 0x10, 0x10])
    expect(pixel(dotted, width, 2, 28)).toEqual([0x10, 0x10, 0x10, 0x10])
    // The original is left as it was.
    expect(pixel(bitmap, width, 28, 3)).toEqual([0x10, 0x10, 0x10, 0x10])
  })

  function setup(platform) {
    const plain = {
      getSize: () => ({width: 16, height: 16}),
      toBitmap: () => Buffer.alloc(32 * 32 * 4),
    }
    const nativeImage = {
      createFromPath: jest.fn(() => plain),
      createFromBitmap: jest.fn((buffer, options) => ({dotted: true, options})),
    }
    const tray = {setImage: jest.fn(), setToolTip: jest.fn()}
    const win = {setOverlayIcon: jest.fn(), isDestroyed: () => false}
    const app = {setBadgeCount: jest.fn(), dock: {setBadge: jest.fn()}}
    const badge = createAppBadge({
      app,
      nativeImage,
      tray: () => tray,
      window: () => win,
      trayImagePath: () => '/tray.png',
      t: (text, {count}) => text.replace('{{count}}', count),
      platform,
    })
    return {badge, app, tray, win, plain}
  }

  it('shows the count on the launcher and a dot on the tray (Linux)', () => {
    const {badge, app, tray, plain} = setup('linux')
    badge.set(4)
    expect(app.setBadgeCount).toHaveBeenLastCalledWith(4)
    expect(tray.setImage.mock.calls[0][0]).toEqual({
      dotted: true,
      options: {width: 32, height: 32, scaleFactor: 2},
    })
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Idena · 4 Social news')
    badge.set(0)
    expect(app.setBadgeCount).toHaveBeenLastCalledWith(0)
    expect(tray.setImage).toHaveBeenLastCalledWith(plain)
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Idena')
  })

  it('draws nothing again for the same count, nor for a wrong one', () => {
    const {badge, app} = setup('linux')
    badge.set(2)
    badge.set(2)
    badge.set('x')
    expect(app.setBadgeCount).toHaveBeenCalledTimes(1)
  })

  it('writes the count on the dock (macOS)', () => {
    const {badge, app} = setup('darwin')
    badge.set(120)
    expect(app.dock.setBadge).toHaveBeenLastCalledWith('99+')
    expect(app.setBadgeCount).not.toHaveBeenCalled()
  })

  it('puts a dot on the taskbar button (Windows)', () => {
    const {badge, win} = setup('win32')
    badge.set(1)
    expect(win.setOverlayIcon.mock.calls[0][0]).toMatchObject({dotted: true})
    expect(win.setOverlayIcon.mock.calls[0][1]).toBe('1 Social news')
    badge.set(0)
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(null, '')
  })
})
