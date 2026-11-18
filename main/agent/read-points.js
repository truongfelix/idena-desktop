const fs = require('fs-extra')

// How far each agent read Idena Social (B-239): the block its last run read up to, kept by the main process in one
// JSON file of the user data folder (agent-read.json), so that a restart does not show it the same posts and
// messages again. A run reads what came after its point, then moves it to the block it read up to.
// The same file keeps, for each daily agent, when its last run that did not fail began (B-274): it runs once a day,
// not again at each start of the app. A build before it reads `points` alone and drops `runs` when it saves.
// It keeps too how many posts that tag it each agent read today (B-264, a day in UTC): its questions of the day, so a
// restart does not give it the day's questions again. An older build drops `tags` when it saves (the count starts
// again that day). And, the same way, how many new posts each agent read today (B-281, `posts`): its posts a day.

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

/** The counts of a day saved under `field` (`tags`, `posts`), each one checked: {agentId: {day, n}}. */
function readCounts(value, field) {
  const saved = value && typeof value === 'object' ? value[field] : null
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

/** Read again (B-295): at most a day back, in hours of blocks (20 s each). */
const MAX_READ_AGAIN_HOURS = 24
const BLOCKS_PER_HOUR = 180

const ADDRESS = /^0x[0-9a-f]{40}$/u
/** A week of blocks (20 s each), and the most acts kept for one agent. */
const ACTS_KEPT_BLOCKS = 7 * 4320
const MAX_ACTS = 500

/** The acts saved, each one checked: {agentId: [{action, who, height}]}. */
function readActs(value) {
  const saved = value && typeof value === 'object' ? value.acts : null
  if (!saved || typeof saved !== 'object') return {}
  return Object.fromEntries(
    Object.entries(saved)
      .filter(([id, list]) => ID_PATTERN.test(id) && Array.isArray(list))
      .map(([id, list]) => [
        id,
        list
          .filter(
            (one) =>
              one &&
              typeof one.action === 'string' &&
              ADDRESS.test(one.who) &&
              isHeight(one.height)
          )
          .slice(-MAX_ACTS),
      ])
  )
}

/** The points over `file` (none: kept until the app closes). */
function createReadPoints({file = null, logger = null, now = Date.now} = {}) {
  let points = {}
  let runs = {}
  let tags = {}
  let posts = {}
  // What each agent did for whom (B-281, once per author): {agentId: [{action, who, height}]}, kept a week of
  // blocks, so an action sent and not yet in a block the Social scan read still counts for its author.
  let acts = {}
  if (file)
    try {
      const saved = fs.readJsonSync(file())
      points = readPoints(saved)
      runs = readRuns(saved)
      tags = readCounts(saved, 'tags')
      posts = readCounts(saved, 'posts')
      acts = readActs(saved)
    } catch (error) {
      if (error.code !== 'ENOENT' && logger)
        logger.warn('agent read points unreadable', error.toString())
    }

  const save = () => {
    if (!file) return
    try {
      const temp = `${file()}.tmp`
      fs.outputJsonSync(
        temp,
        {v: 1, points, runs, tags, posts, acts},
        {spaces: 2}
      )
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
      /**
       * Read again the last `hours` (B-295, at most MAX_READ_AGAIN_HOURS): the point goes back to that many hours of
       * blocks before `head` (the block the Social scan read), never forward. What it answered already is skipped by
       * the run (digest.js), and what it reads counts in its day as usual.
       */
      readAgain(data) {
        const {agentId, hours, head} = data || {}
        if (!ID_PATTERN.test(agentId)) throw new Error('no agent named')
        if (
          !Number.isInteger(hours) ||
          hours < 1 ||
          hours > MAX_READ_AGAIN_HOURS
        )
          throw new Error('not a number of hours')
        if (!isHeight(head)) throw new Error('not a block height')
        const height = Math.max(0, head - hours * BLOCKS_PER_HOUR)
        const has = Object.prototype.hasOwnProperty.call(points, agentId)
        if (!has || points[agentId] > height) {
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
      /** What the agent `agentId` did for whom, as noted: [{action, who, height}]. */
      actsDone(data) {
        return acts[data && data.agentId] || []
      },
      /** The agent `agentId` did `action` for the people `whom` at the block `height`; older than a week go. */
      noteActs(data) {
        const {agentId, action, whom, height} = data || {}
        if (!ID_PATTERN.test(agentId)) throw new Error('no agent named')
        if (typeof action !== 'string' || !isHeight(height))
          throw new Error('not an action done')
        const added = (Array.isArray(whom) ? whom : [])
          .map((who) => String(who || '').toLowerCase())
          .filter((who) => ADDRESS.test(who))
          .map((who) => ({action: action.slice(0, 20), who, height}))
        if (!added.length) return acts[agentId] || []
        acts = {
          ...acts,
          [agentId]: [...(acts[agentId] || []), ...added]
            .filter((one) => one.height > height - ACTS_KEPT_BLOCKS)
            .slice(-MAX_ACTS),
        }
        save()
        return acts[agentId]
      },
      /** How many new posts the agent `agentId` read today (a day in UTC, B-281). */
      postsToday(data) {
        const one = posts[data && data.agentId]
        return one && one.day === utcDay(now()) ? one.n : 0
      },
      /** The agent `agentId` read `n` more new posts today; returns today's count. */
      countPosts(data) {
        const {agentId, n} = data || {}
        if (!ID_PATTERN.test(agentId)) throw new Error('no agent named')
        if (!Number.isSafeInteger(n) || n < 0) throw new Error('not a count')
        const day = utcDay(now())
        const before =
          posts[agentId] && posts[agentId].day === day ? posts[agentId].n : 0
        if (n > 0) {
          posts = {...posts, [agentId]: {day, n: before + n}}
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
      const keptPosts = Object.fromEntries(
        Object.entries(posts).filter(([id]) => liveIds.includes(id))
      )
      const keptActs = Object.fromEntries(
        Object.entries(acts).filter(([id]) => liveIds.includes(id))
      )
      if (
        Object.keys(kept).length !== Object.keys(points).length ||
        Object.keys(keptRuns).length !== Object.keys(runs).length ||
        Object.keys(keptTags).length !== Object.keys(tags).length ||
        Object.keys(keptPosts).length !== Object.keys(posts).length ||
        Object.keys(keptActs).length !== Object.keys(acts).length
      ) {
        points = kept
        runs = keptRuns
        tags = keptTags
        posts = keptPosts
        acts = keptActs
        save()
      }
    },
  }
}

module.exports = {createReadPoints}
