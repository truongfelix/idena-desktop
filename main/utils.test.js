jest.mock('./stores/settings', () => ({persistZoomLevel: jest.fn()}))

const {persistZoomLevel} = require('./stores/settings')
const {zoomIn, zoomOut, resetZoom} = require('./utils')

function windowAt(zoomLevel, {destroyed = false} = {}) {
  return {
    webContents: {
      zoomLevel,
      isDestroyed: () => destroyed,
    },
  }
}

describe('View menu zoom', () => {
  beforeEach(() => {
    persistZoomLevel.mockClear()
  })

  it('zooms the window in, out and back, and saves the level', () => {
    const window = windowAt(1)

    zoomIn(window)
    expect(window.webContents.zoomLevel).toBe(2)
    zoomOut(window)
    zoomOut(window)
    expect(window.webContents.zoomLevel).toBe(0)
    zoomOut(window)
    expect(window.webContents.zoomLevel).toBe(-1)
    resetZoom(window)
    expect(window.webContents.zoomLevel).toBe(0)

    expect(persistZoomLevel.mock.calls).toEqual([[2], [1], [0], [-1], [0]])
  })

  // macOS keeps the menu and its shortcuts with the main window hidden: the click gets no window.
  it.each([
    ['no window', undefined],
    ['a window without web contents', {}],
    ['a closed window', windowAt(2, {destroyed: true})],
  ])('does nothing for %s', (_, window) => {
    for (const zoom of [zoomIn, zoomOut, resetZoom]) {
      expect(() => zoom(window)).not.toThrow()
    }
    if (window && window.webContents) {
      expect(window.webContents.zoomLevel).toBe(2)
    }
    expect(persistZoomLevel).not.toHaveBeenCalled()
  })
})
