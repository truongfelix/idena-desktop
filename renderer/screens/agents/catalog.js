// The Agents section's words for what an agent may do, read, when it runs and what it spends (main/agent/profiles.js,
// settings.js ACTIONS). Its rights follow the app's areas (ruling Q-64, notes/agent-areas.md): each action belongs
// to one. The catalog holds the actions that have a tool in this version.

/** The areas, in the menu's order, by id. */
export function areaNames(t) {
  return {flips: t('Flips'), validation: t('Validation'), social: t('Social')}
}
export const AREAS = ['flips', 'validation', 'social']

/** The actions an agent can be given, in the catalog's order: `info` says what each is for. */
export function actionCatalog(t) {
  return [
    {
      id: 'flipStory',
      area: 'flips',
      label: t('Write flip stories'),
      info: t(
        "Writes a flip's story and one picture prompt per frame, from the flip's two keywords, in the flip editor."
      ),
      reads: [t('The two keywords of the flip you make')],
    },
    {
      id: 'answerFlip',
      area: 'validation',
      label: t('Answer the flips'),
      info: t(
        'Answers the flips of a validation. Ask me: its answer is shown, you choose.',
        {nsSeparator: '!!'}
      ),
      reads: [t('The flips and keywords of the session')],
    },
    {
      id: 'report',
      area: 'validation',
      label: t('Report flips'),
      info: t(
        'Reports the flips that break a rule, as When to report sets it.'
      ),
      reads: [t('The flips and keywords of the session')],
    },
    {
      id: 'post',
      area: 'social',
      label: t('Post on Social'),
      info: t('Writes posts of its own. It reads its own last posts.'),
      reads: [t('Its own last posts')],
      defaults: {level: 'off', limit: 1},
      perDay: 'count',
      // It spends iDNA (fees, a tip's amount): the budget counts it.
      spends: true,
    },
    {
      id: 'reply',
      area: 'social',
      label: t('Reply and comment'),
      info: t('Answers the posts, replies and comments it read.'),
      reads: [],
      defaults: {level: 'off', limit: 5},
      perDay: 'count',
      // It spends iDNA (fees, a tip's amount): the budget counts it.
      spends: true,
    },
    {
      id: 'like',
      area: 'social',
      label: t('Like posts'),
      info: t('Likes the posts, replies and comments it read.'),
      reads: [],
      defaults: {level: 'off', limit: 10},
      perDay: 'count',
      // It spends iDNA (fees, a tip's amount): the budget counts it.
      spends: true,
    },
    {
      id: 'message',
      area: 'social',
      label: t('Private messages'),
      info: t(
        'Writes private messages: in its conversations, to the author of a post it read, or to someone who liked or tipped it.',
        {nsSeparator: '!!'}
      ),
      reads: [],
      defaults: {level: 'off', limit: 3},
      perDay: 'count',
      // It spends iDNA (fees, a tip's amount): the budget counts it.
      spends: true,
    },
    {
      id: 'tip',
      area: 'social',
      label: t('Tip posts'),
      info: t(
        'Tips the authors of posts it read. You set the amount of each tip; it picks the posts.'
      ),
      reads: [],
      defaults: {level: 'off', limit: 5, amount: 1},
      perDay: 'idna',
      // It spends iDNA (fees, a tip's amount): the budget counts it.
      spends: true,
    },
  ]
}

/** What the agent reads on Social (profiles.js reads), each in words. */
export function socialReadsList({reads}, t) {
  const out = []
  if (reads.posts.window === 'day')
    out.push(t('The posts of the last 24 hours'))
  if (reads.posts.window === 'count')
    out.push(t('The last {{count}} posts', {count: reads.posts.count}))
  if (reads.notifications)
    out.push(t('Its notifications: likes, answers, tips', {nsSeparator: '!!'}))
  if (reads.messages) out.push(t('Its private messages'))
  return out
}

/** What an agent wants to do, as To approve says it, for every action an agent can ask for (settings.js ACTIONS). */
export function actionWants(action, t) {
  switch (action) {
    case 'answerFlip':
      return t('wants to answer a flip')
    case 'report':
      return t('wants to report a flip')
    case 'send':
      return t('wants to send iDNA')
    case 'post':
      return t('wants to post on Social')
    case 'tip':
      return t('wants to tip a post')
    case 'reply':
      return t('wants to reply on Social')
    case 'like':
      return t('wants to like a post')
    case 'message':
      return t('wants to send a private message')
    case 'ads':
      return t('wants to change an ad')
    case 'oracleVote':
      return t('wants to vote in an oracle voting')
    case 'invite':
      return t('wants to send an invitation')
    default:
      return t('wants to act')
  }
}

/** An action's name, as Activity says it. */
export function actionName(action, t) {
  switch (action) {
    case 'answerFlip':
      return t('Answer the flips')
    case 'report':
      return t('Report flips')
    case 'send':
      return t('Send iDNA')
    case 'post':
      return t('Post on Social')
    case 'tip':
      return t('Tip posts')
    case 'reply':
      return t('Reply and comment')
    case 'like':
      return t('Like posts')
    case 'message':
      return t('Private messages')
    case 'social':
      return t('Idena Social')
    case 'ads':
      return t('Ads')
    case 'oracleVote':
      return t('Vote in oracle votings')
    case 'invite':
      return t('Invite')
    case 'flipStory':
      return t('Write flip stories')
    default:
      return action
  }
}

/** A line of To approve's steps in Activity (main/agent/pending.js), or null for another line. */
export function pendingActivityText({action, decision, detail}, t) {
  const name = actionName(action, t)
  const opts = {action: name, detail}
  if (['answerFlip', 'test', 'settings', 'key'].includes(action)) return null
  switch (decision) {
    case 'ask':
      return t('{{action}}: waits for your approval', {
        ...opts,
        nsSeparator: '!!',
      })
    case 'approved':
      return detail
        ? t('{{action}}: done after your approval ({{detail}})', {
            ...opts,
            nsSeparator: '!!',
          })
        : t('{{action}}: done after your approval', {
            ...opts,
            nsSeparator: '!!',
          })
    case 'declined':
      return t('{{action}}: declined by you', {...opts, nsSeparator: '!!'})
    case 'dropped':
      return t('{{action}}: taken off To approve ({{detail}})', {
        ...opts,
        nsSeparator: '!!',
      })
    case 'alone':
      return t('{{action}}: done alone ({{detail}})', {
        ...opts,
        nsSeparator: '!!',
      })
    case 'skipped':
      return t('{{action}}: skipped ({{detail}})', {
        ...opts,
        nsSeparator: '!!',
      })
    case 'off':
      return t('{{action}}: refused ({{detail}})', {
        ...opts,
        nsSeparator: '!!',
      })
    case 'failed':
      return t('{{action}}: failed ({{detail}})', {...opts, nsSeparator: '!!'})
    default:
      return null
  }
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
  if (schedule.kind === 'hourly') return t('Every hour')
  if (schedule.kind === 'daily')
    return t('Every day at {{time}}', {time: schedule.time})
  return t('When I ask')
}

/**
 * What the model is sent: what its actions that are not Off need, and what it reads on Social, each once. Nothing
 * else is sent to it.
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
  socialReadsList(agent, t).forEach((item) => reads.push(item))
  return reads.length ? reads : [t('Nothing')]
}

/** The agent's actions that spend iDNA (the budget counts them), by label. */
export const spendingActions = (agent, catalog) =>
  catalog.filter(({id, spends}) => spends && agent.actions[id])

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

/** The actions only one agent may hold (main/agent/profiles.js SINGLE_HOLDER_ACTIONS). */
export const SINGLE_HOLDER = ['answerFlip', 'report']

/**
 * Whether the agent can be given an action: one only one agent may hold (the validation's answers, its reports) is
 * held by another agent, named. Returns null when it can.
 */
export function heldBy(actionId, agent, agents) {
  if (!SINGLE_HOLDER.includes(actionId)) return null
  const holder = agents.find(
    (other) => other.id !== agent.id && other.actions[actionId]
  )
  return holder ? holder.name : null
}
