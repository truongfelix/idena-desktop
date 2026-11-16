// The rights table's logic (B-280): every right of the catalog is a row of its area, whether the agent was given it
// or not. The saved format does not change (main/agent/profiles.js): a right the agent was never given is no entry,
// and shows Off.

import {SINGLE_HOLDER} from './catalog'

/** A right's row as the table shows it: the agent's own, or the catalog's defaults set to Off. */
export const rowOf = (agent, {id, defaults}) =>
  agent.actions[id] || {...(defaults || {}), level: 'off'}

/** Whether the agent holds a right that is not Off. */
export const isOn = (agent, id) =>
  Boolean(agent.actions[id]) && agent.actions[id].level !== 'off'

/**
 * The agent's actions after a change to one row. A right only one agent may hold is taken out when set to Off, so
 * another agent can be given it; any other keeps its limits while Off.
 */
export function withRow(actions, entry, patch) {
  const row = {...rowOf({actions}, entry), ...patch}
  if (SINGLE_HOLDER.includes(entry.id) && row.level === 'off') {
    const next = {...actions}
    delete next[entry.id]
    return next
  }
  return {...actions, [entry.id]: row}
}

/** How many of an area's rights are not Off, of how many. */
export function areaCount(agent, catalog, area) {
  const rows = catalog.filter((entry) => entry.area === area)
  return {on: rows.filter(({id}) => isOn(agent, id)).length, of: rows.length}
}

/** The area the table opens on: the first with a right that is not Off, else the first. */
export const firstArea = (agent, catalog, areas) =>
  areas.find((area) => areaCount(agent, catalog, area).on > 0) || areas[0]

/** The Flips steps a starting point sets, in the catalog's order. */
export const FLIP_STEPS = [
  'flipStory',
  'flipPictures',
  'flipDraft',
  'flipJudge',
  'flipSubmit',
  'flipDelete',
]

/** The starting points of the Flips area: each sets the level of every step, and leaves their limits. */
export function flipStarts(t) {
  const all = (level) => Object.fromEntries(FLIP_STEPS.map((id) => [id, level]))
  return [
    {id: 'ask', label: t('Ask me at every step'), levels: all('ask')},
    {
      id: 'drafts',
      label: t('It prepares the drafts, I send'),
      levels: {...all('alone'), flipSubmit: 'ask'},
    },
    {id: 'alone', label: t('It makes and sends alone'), levels: all('alone')},
  ]
}

/** The agent's actions after a starting point: each step at its level, its limits kept (the defaults for a new one). */
export function withLevels(actions, catalog, levels) {
  return catalog
    .filter(({id}) => levels[id])
    .reduce((next, entry) => withRow(next, entry, {level: levels[entry.id]}), {
      ...actions,
    })
}
