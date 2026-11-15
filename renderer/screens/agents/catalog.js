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
    {
      id: 'post',
      label: t('Post on Social'),
      limit: t('At most once a day; with Alone, within its budget'),
      // The joke agent's post (B-237) reads its own; another agent's, the Social run's (B-239).
      jokeReads: [
        t('The tips on its posts since its last joke'),
        t('Its last 30 jokes, not to repeat them'),
        t("The tippers' names from their profiles"),
      ],
      reads: [t('The new posts since its last run')],
      defaults: {level: 'off', limit: 1},
      perDay: 'count',
    },
    {
      id: 'reply',
      label: t('Reply and comment'),
      limit: t(
        'Answers posts, replies and comments it read; with Alone, at most the number a day below, within its budget'
      ),
      reads: [
        t('The new posts since its last run'),
        t('The answers to its posts, replies and comments'),
      ],
      defaults: {level: 'off', limit: 5},
      perDay: 'count',
    },
    {
      id: 'like',
      label: t('Like posts'),
      limit: t('With Alone, at most the number a day below, within its budget'),
      reads: [
        t('The new posts since its last run'),
        t('The answers to its posts, replies and comments'),
      ],
      defaults: {level: 'off', limit: 10},
      perDay: 'count',
    },
    {
      id: 'message',
      label: t('Private messages'),
      limit: t(
        'Answers the people who wrote to it, or writes to the author of a post it read; no group. With Alone, at most the number a day below.'
      ),
      reads: [
        t('Its private conversations with a new message'),
        t('The new posts since its last run'),
      ],
      defaults: {level: 'off', limit: 3},
      perDay: 'count',
    },
    {
      id: 'tip',
      label: t('Tip posts'),
      limit: t(
        'You set the amount of each tip; the agent only picks the posts. With Alone, at most the total a day below, within its budget.'
      ),
      reads: [
        t('The new posts since its last run'),
        t('The answers to its posts, replies and comments'),
      ],
      defaults: {level: 'off', limit: 5, amount: 1},
      perDay: 'idna',
    },
    {
      id: 'flipStory',
      label: t('Write flip stories'),
      limit: t(
        'In the flip editor, from the two keywords: a story and one image prompt per picture. Ask me: when you click Write a story. Alone: as soon as the keywords show. Nothing goes to the chain.',
        {nsSeparator: '!!'}
      ),
      reads: [t('The two keywords of the flip you make')],
    },
  ]
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
 * What the model is sent: what its actions that are not Off need, each once. Nothing else is sent to it.
 */
export function readsList(agent, catalog, t) {
  const reads = []
  catalog.forEach(({id, reads: other, jokeReads}) => {
    const row = agent.actions[id]
    if (!row || row.level === 'off') return
    const needs = agent.task === 'joke' && jokeReads ? jokeReads : other
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
