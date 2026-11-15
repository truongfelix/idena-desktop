const fs = require('fs-extra')

// How far each agent read Idena Social (B-239): the block its last run read up to, kept by the main process in one
// JSON file of the user data folder (agent-read.json), so that a restart does not show it the same posts and
// messages again. A run reads what came after its point, then moves it to the block it read up to.

const ID_PATTERN = /^[0-9a-f]{16}$/u

const isHeight = (value) => Number.isInteger(value) && value >= 0

/** The saved points, each one checked: {agentId: height}. */
function readPoints(value) {
  const saved = value && typeof value === 'object' ? value.points : null
  if (!saved || typeof saved !== 'object') return {}
  return Object.fromEntries(
    Object.entries(saved).filter(
      ([id, height]) => ID_PATTERN.test(id) && isHeight(height)
    )
  )
}

/** The points over `file` (none: kept until the app closes). */
function createReadPoints({file = null, logger = null} = {}) {
  let points = {}
  if (file)
    try {
      points = readPoints(fs.readJsonSync(file()))
    } catch (error) {
      if (error.code !== 'ENOENT' && logger)
        logger.warn('agent read points unreadable', error.toString())
    }

  const save = () => {
    if (!file) return
    try {
      const temp = `${file()}.tmp`
      fs.outputJsonSync(temp, {v: 1, points}, {spaces: 2})
      fs.renameSync(temp, file())
    } catch (error) {
      if (logger) logger.warn('agent read points not written', error.toString())
    }
  }

  return {
    commands: {
      /** The block the agent `agentId` read up to, or null before its first run. */
      readPoint(data) {
        const id = data && data.agentId
        return Object.prototype.hasOwnProperty.call(points, id)
          ? points[id]
          : null
      },
      /** The agent read up to `height`: a point never goes back (a late run cannot show it old posts again). */
      setReadPoint(data) {
        const {agentId, height} = data || {}
        if (!ID_PATTERN.test(agentId)) throw new Error('no agent named')
        if (!isHeight(height)) throw new Error('not a block height')
        if (!(points[agentId] >= height)) {
          points = {...points, [agentId]: height}
          save()
        }
        return points[agentId]
      },
    },
    /** After a change of the agents (`liveIds`, the ids left): a removed agent's point goes with it. */
    keepOnly(liveIds) {
      const kept = Object.fromEntries(
        Object.entries(points).filter(([id]) => liveIds.includes(id))
      )
      if (Object.keys(kept).length !== Object.keys(points).length) {
        points = kept
        save()
      }
    },
  }
}

module.exports = {createReadPoints}
