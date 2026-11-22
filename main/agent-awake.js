// Whether the window's timers stay awake for a validation agent (B-302): while any of its askers asks, the app's root
// (the lottery and both sessions) or the validation screen (a practice too). A page load ends every request.
const SOURCES = new Set(['root', 'screen'])

function createAgentAwake(setBackgroundThrottling) {
  const askers = new Set()
  const apply = () => setBackgroundThrottling(askers.size === 0)
  return {
    /** `source` asks (`on`) or stops asking; an unknown source is ignored. */
    set(source, on) {
      if (!SOURCES.has(source)) return
      if (on) askers.add(source)
      else askers.delete(source)
      apply()
    },
    /** A page load starts: what the page asked ends with it. */
    reset() {
      askers.clear()
      apply()
    },
  }
}

module.exports = {createAgentAwake}
