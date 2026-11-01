const {prepareDb} = require('./setup')

module.exports = {
  // The window's theme choice (main/theme.js), as the window saved it; undefined when it never did.
  savedTheme() {
    return prepareDb('settings').get('theme').value()
  },
  persistZoomLevel(level) {
    prepareDb('settings').set('zoomLevel', level).write()
  },
}
