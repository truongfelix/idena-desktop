// The window's theme (B-166): 'system' follows the system's light or dark setting, 'light' and 'dark' force one.
// The main process sets Electron's nativeTheme.themeSource to it: Chromium then gives the window the matching
// prefers-color-scheme, which the window's colours follow (renderer/shared/theme.js), and the system's own dialogs
// and scrollbars too. The user's choice is saved with the window's settings (settings.json, key `theme`).

const THEME_SOURCES = ['system', 'light', 'dark']

/** The theme to apply for a saved or sent value: 'system' for anything else (a new install, an older settings file). */
function themeSource(value) {
  return THEME_SOURCES.includes(value) ? value : 'system'
}

module.exports = {THEME_SOURCES, themeSource}
