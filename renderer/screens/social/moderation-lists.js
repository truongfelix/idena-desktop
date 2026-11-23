import {activeBan, normalHex} from './moderation'

// What the Moderation page lists (views/moderation.js), from the moderation state and the feed as scanned.

/** Every post, reply and comment of the feed (socialFeed's nodes) by lowercase transaction hash. */
export function postsByHash(feed) {
  const byHash = new Map()
  const visit = (node) => {
    byHash.set(normalHex(node.call.hash), node)
    node.replies.forEach(visit)
  }
  feed.forEach(visit)
  return byHash
}

/**
 * The reports grouped by target (an account or a post), each reporter's last report once, newest first; the reports
 * of an account banned now left out (banning one that floods reports clears them). Most reporters first, then the
 * newest. Each group: {kind, target, reports, newest}.
 */
export function reportGroups(state, epoch) {
  const byTarget = new Map()
  for (const report of state.reports) {
    // eslint-disable-next-line no-continue
    if (activeBan(state, report.reporter, epoch)) continue
    const key = `${report.kind}:${report.target}`
    if (!byTarget.has(key)) byTarget.set(key, new Map())
    byTarget.get(key).set(report.reporter, report)
  }
  return [...byTarget.values()]
    .map((byReporter) => {
      const reports = [...byReporter.values()].sort((x, y) => y.time - x.time)
      return {
        kind: reports[0].kind,
        target: reports[0].target,
        reports,
        newest: reports[0].time,
      }
    })
    .sort((x, y) => y.reports.length - x.reports.length || y.newest - x.newest)
}

/**
 * Why a report group needs nothing more, or null while it is open: its account banned, its post hidden, or the post's
 * `author` banned. An unban opens it again.
 */
export function reportResolution(group, author, state, epoch) {
  if (group.kind === 'address')
    return activeBan(state, group.target, epoch) ? 'accountBanned' : null
  if (state.hidden.has(group.target)) return 'postHidden'
  if (author && activeBan(state, author, epoch)) return 'authorBanned'
  return null
}

/** The accounts banned now, newest ban first: [{address, ban}]. */
export const bannedAccounts = (state, epoch) =>
  [...state.bans.entries()]
    .filter(([address]) => activeBan(state, address, epoch))
    .map(([address, ban]) => ({address, ban}))
    .sort((x, y) => (y.ban.bannedAt || 0) - (x.ban.bannedAt || 0))

/** The posts hidden one by one, newest first: [{hash, hidden}]. */
export const hiddenPosts = (state) =>
  [...state.hidden.entries()]
    .map(([hash, hidden]) => ({hash, hidden}))
    .sort((x, y) => (y.hidden.hiddenAt || 0) - (x.hidden.hiddenAt || 0))

/** An account's posts, replies and comments not hidden one by one yet, newest first: the ones to clean up. */
export const postsToReview = (feed, state, address) =>
  [...postsByHash(feed).values()]
    .filter(
      (node) =>
        node.call.author === normalHex(address) &&
        !state.hidden.has(normalHex(node.call.hash))
    )
    .sort(
      (x, y) => y.call.height - x.call.height || y.call.index - x.call.index
    )

/** The moderation log: the decisions, newest first (reports are in the Reports tab). */
export const moderationLog = (events) =>
  events
    .filter((e) => e.name !== 'report' && e.name !== 'reportTransaction')
    .slice()
    .reverse()
