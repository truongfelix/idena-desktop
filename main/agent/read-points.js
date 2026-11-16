const fs = require('fs-extra')

// How far each agent read Idena Social (B-239): the block its last run read up to, kept by the main process in one
// JSON file of the user data folder (agent-read.json), so that a restart does not show it the same posts and
// messages again. A run reads what came after its point, then moves it to the block it read up to.
// The same file keeps, for each daily agent, when its last run that did not fail began (B-274): it runs once a day,
// not again at each start of the app. A build before it reads `points` alone and drops `runs` when it saves.
// It keeps too how many posts that tag it each agent read today (B-264, a day in UTC): its questions of the day, so a
// restart does not give it the day's questions again. An older build drops `tags` when it saves (the count starts
// again that day).

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

/** The last runs saved, each one checked: {agentId: ms}. */
function readRuns(value) {
  const saved = value && typeof value === 'object' ? value.runs : null
  if (!saved || typeof saved !== 'object') return {}
  return Object.fromEntries(
    Object.entries(saved).filter(
      ([id, at]) => ID_PATTERN.test(id) && Number.isSafeInteger(at) && at > 0
    )
  )
}

/** The day of `ms` in UTC, as YYYY-MM-DD: the questions' day (B-264). */
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The tags counted, each one checked: {agentId: {day, n}}. */
function readTags(value) {
  const saved = value && typeof value === 'object' ? value.tags : null
  if (!saved || typeof saved !== 'object') return {}
  return Object.fromEntries(
    Object.entries(saved).filter(
      ([id, one]) =>
        ID_PATTERN.test(id) &&
        one &&
        typeof one.day === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/u.test(one.day) &&
        Number.isSafeInteger(one.n) &&
        one.n >= 0
    )
  )
}

/** The points over `file` (none: kept until the app closes). */
function createReadPoints({file = null, logger = null, now = Date.now} = {}) {
  let points = {}
  let runs = {}
  let tags = {}
  if (file)
    try {
      const saved = fs.readJsonSync(file())
      points = readPoints(saved)
      runs = readRuns(saved)
      tags = readTags(saved)
    } catch (error) {
      if (error.code !== 'ENOENT' && logger)
        logger.warn('agent read points unreadable', error.toString())
    }

  const save = () => {
    if (!file) return
    try {
      const temp = `${file()}.tmp`
      fs.outputJsonSync(temp, {v: 1, points, runs, tags}, {spaces: 2})
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
      /** When the agent `agentId`'s last run that did not fail began (ms), or null. */
      lastRun(data) {
        const id = data && data.agentId
        return Object.prototype.hasOwnProperty.call(runs, id) ? runs[id] : null
      },
      /** The agent `agentId`'s run that began `at` (ms; after now, a clock set back meanwhile: now) did not fail. */
      setLastRun(data) {
        const {agentId, at} = data || {}
        if (!ID_PATTERN.test(agentId)) throw new Error('no agent named')
        if (!Number.isSafeInteger(at) || at <= 0) throw new Error('not a time')
        runs = {...runs, [agentId]: Math.min(at, now())}
        save()
        return runs[agentId]
      },
      /** How many posts that tag it the agent `agentId` read today (a day in UTC). */
      tagsToday(data) {
        const one = tags[data && data.agentId]
        return one && one.day === utcDay(now()) ? one.n : 0
      },
      /** The agent `agentId` read `n` more posts that tag it today; returns today's count. */
      countTags(data) {
        const {agentId, n} = data || {}
        if (!ID_PATTERN.test(agentId)) throw new Error('no agent named')
        if (!Number.isSafeInteger(n) || n < 0) throw new Error('not a count')
        const day = utcDay(now())
        const before =
          tags[agentId] && tags[agentId].day === day ? tags[agentId].n : 0
        if (n > 0) {
          tags = {...tags, [agentId]: {day, n: before + n}}
          save()
        }
        return before + n
      },
    },
    /** After a change of the agents (`liveIds`, the ids left): a removed agent's point goes with it. */
    keepOnly(liveIds) {
      const kept = Object.fromEntries(
        Object.entries(points).filter(([id]) => liveIds.includes(id))
      )
      const keptRuns = Object.fromEntries(
        Object.entries(runs).filter(([id]) => liveIds.includes(id))
      )
      const keptTags = Object.fromEntries(
        Object.entries(tags).filter(([id]) => liveIds.includes(id))
      )
      if (
        Object.keys(kept).length !== Object.keys(points).length ||
        Object.keys(keptRuns).length !== Object.keys(runs).length ||
        Object.keys(keptTags).length !== Object.keys(tags).length
      ) {
        points = kept
        runs = keptRuns
        tags = keptTags
        save()
      }
    },
  }
}

module.exports = {createReadPoints}
