// The Agents section's words for what an agent may do, when it runs, what it reads and spends
// (main/agent/profiles.js, settings.js ACTIONS). The catalog holds the actions that have a tool in this version:
// the others (post, tip, send, …) join it with their tools.

/** The actions an agent can be given, in the order of the catalog. */
export function actionCatalog(t) {
  return [
    {
      id: 'answerFlip',
      label: t('Answer the flips'),
      limit: t(
        'Alone = Autopilot, Ask me = Suggest (its pick is highlighted, you click). A flip it cannot answer in time stays unanswered.'
      ),
      reads: [t('The flips and keywords of the session')],
    },
    {
      id: 'report',
      label: t('Report flips'),
      limit: t(
        'Only when it is sure enough that the flip breaks a rule (When to report, below)'
      ),
      reads: [t('The flips and keywords of the session')],
      needs: 'answerFlip',
    },
  ]
}

export const LEVELS = ['off', 'ask', 'alone']

export function levelLabel(level, t) {
  if (level === 'alone') return t('Alone')
  if (level === 'ask') return t('Ask me')
  return t('Off')
}

/** The agent's actions in one line, each with its level, in the catalog's order. */
export function actionsLine(agent, catalog, t) {
  const rows = catalog.filter(({id}) => agent.actions[id])
  if (!rows.length) return t('None yet')
  return rows
    .map(
      ({id, label}) => `${label} (${levelLabel(agent.actions[id].level, t)})`
    )
    .join(', ')
}

/** When it runs, in words. */
export function runsLine({schedule}, t) {
  if (schedule.kind === 'validation') return t('At each validation')
  if (schedule.kind === 'daily')
    return t('Every day at {{time}}', {time: schedule.time})
  return t('When I ask')
}

/**
 * What the model is sent: what its actions that are not Off need, each once. Nothing else is sent to it.
 */
export function readsList(agent, catalog, t) {
  const reads = []
  catalog.forEach(({id, reads: needs}) => {
    const row = agent.actions[id]
    if (!row || row.level === 'off') return
    needs.forEach((item) => {
      if (!reads.includes(item)) reads.push(item)
    })
  })
  return reads.length
    ? reads
    : [t('Nothing: every action is off', {nsSeparator: '!!'})]
}

export function budgetLine({budgetPerDay}, t) {
  if (budgetPerDay === null || budgetPerDay === 0) return t('Spends no iDNA')
  return t('Up to {{amount}} iDNA a day', {amount: budgetPerDay})
}

/** Where the model runs, as the cards show it. */
export function connectionLine({provider, model}, t) {
  const where = {
    local: t('On this computer'),
    openai: t('OpenAI-compatible service'),
    anthropic: t('Anthropic API'),
  }[provider]
  return model ? `${model} · ${where}` : t('No model chosen yet')
}

/** The letter on the agent's badge. */
export const initialOf = (name) => (name.trim()[0] || 'A').toUpperCase()

/**
 * Whether the agent can be given an action: one only one agent may hold (the validation's answers) is held by
 * another agent, named. Returns null when it can.
 */
export function heldBy(actionId, agent, agents) {
  if (actionId !== 'answerFlip') return null
  const holder = agents.find(
    (other) => other.id !== agent.id && other.actions.answerFlip
  )
  return holder ? holder.name : null
}
