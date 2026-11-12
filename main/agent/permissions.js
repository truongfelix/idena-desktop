const {ACTIONS} = require('./settings')

// The one check every action of the agent goes through, in the main process: the action's level and limit decide
// whether the agent may not do it, may suggest it, or may do it alone. The action itself then runs the same code as
// the user's click; the agent never holds the identity's key.

/**
 * What the agent may do for one action. `usage` is what it already did within the limit's span (reports in this
 * validation, iDNA sent today) and `amount` what this action adds (1 report, the iDNA of a send).
 * Returns {decision: 'off' | 'ask' | 'alone', reason}.
 */
function checkAction(settings, action, {usage = 0, amount = 1} = {}) {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
    return {decision: 'off', reason: 'unknown action'}
  if (!settings || settings.enabled !== true)
    return {decision: 'off', reason: 'agent off'}
  if (settings.paused === true) return {decision: 'off', reason: 'paused'}
  const row = settings.permissions && settings.permissions[action]
  if (!row || row.level === 'off')
    return {decision: 'off', reason: 'action off'}
  if (row.level === 'ask') return {decision: 'ask', reason: 'asks first'}
  if (row.level !== 'alone') return {decision: 'off', reason: 'action off'}
  if (row.limit !== null && Number(usage) + Number(amount) > row.limit)
    return {decision: 'ask', reason: 'above the limit'}
  return {decision: 'alone', reason: 'within the limit'}
}

module.exports = {checkAction}
