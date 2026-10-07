/** An identity's state (dna_identity) as idena.social names it: "Not validated" without one. */
export const identityStatus = (state) =>
  !state || state === 'Undefined' ? 'Not validated' : state

/**
 * How long ago `time` was at `now` (Unix seconds), as Reddit shows it: 5s, 10min, 7h, 1d, 5mo, 2y (a month counted
 * as 30 days, a year as 365); "now" for a time in the future (a computer clock behind the block's).
 */
export function timeAgo(time, now) {
  const s = now - time
  if (s < 0) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}mo`
  return `${Math.floor(s / (365 * 86400))}y`
}

/** The color of an identity state, as the phone app shows it (light theme); null for no identity. */
export const IDENTITY_COLORS = {
  Human: '#B8860B',
  Verified: '#1565C0',
  Newbie: '#2E7D32',
  Candidate: '#00838F',
  Invite: '#7B1FA2',
  Suspended: '#E65100',
  Zombie: '#C62828',
  Killed: '#5D4037',
}

export const identityColor = (state) => IDENTITY_COLORS[state] || null

/** "Human · age 12"; the state alone without an identity or at age 0. */
export function identityLabel(state, age) {
  const status = identityStatus(state)
  return age > 0 && status !== 'Not validated'
    ? `${status} · age ${age}`
    : status
}
