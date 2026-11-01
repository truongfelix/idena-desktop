const {THEME_SOURCES, themeSource} = require('./theme')

describe('the window theme', () => {
  it('applies the three choices as they are', () => {
    for (const source of THEME_SOURCES) expect(themeSource(source)).toBe(source)
  })

  it('follows the system for anything else', () => {
    for (const value of [undefined, null, '', 'Dark', 'blue', 1, {}])
      expect(themeSource(value)).toBe('system')
  })
})
