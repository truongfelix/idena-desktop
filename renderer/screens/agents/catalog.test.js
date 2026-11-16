import {
  actionCatalog,
  actionsLine,
  budgetLine,
  heldBy,
  readsList,
  spendingActions,
  runsLine,
} from './catalog'
import {agentsDot} from './menu-state'
import {nothingToActOn} from './page-sections'
import {activityText} from '../settings/agent/activity-section'

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))
const catalog = actionCatalog(t)
const agent = (more = {}) => ({
  id: 'a',
  name: 'A',
  enabled: true,
  actions: {},
  schedule: {kind: 'manual', time: '09:00'},
  reads: {
    posts: {window: 'off', count: 10},
    notifications: false,
    messages: false,
  },
  events: [],
  budgetPerDay: null,
  ...more,
})

describe('the Agents section lines', () => {
  test('actions in the catalog order, each with its level', () => {
    expect(actionsLine(agent(), catalog, t)).toBe('None yet')
    expect(
      actionsLine(
        agent({
          actions: {report: {level: 'ask'}, answerFlip: {level: 'alone'}},
        }),
        catalog,
        t
      )
    ).toBe('Answer the flips (Alone), Report flips (Ask me)')
    // A right set to Off stays a row of the table (B-280): the line leaves it out.
    expect(
      actionsLine(
        agent({actions: {post: {level: 'off'}, like: {level: 'ask'}}}),
        catalog,
        t
      )
    ).toBe('Like posts (Ask me)')
    expect(
      actionsLine(agent({actions: {post: {level: 'off'}}}), catalog, t)
    ).toBe('None yet')
  })

  test('the model reads only what its actions that are not off need, each once', () => {
    expect(readsList(agent(), catalog, t)).toEqual(['Nothing'])
    expect(
      readsList(agent({actions: {answerFlip: {level: 'off'}}}), catalog, t)
    ).toEqual(['Nothing'])
    expect(
      readsList(
        agent({actions: {answerFlip: {level: 'ask'}, report: {level: 'ask'}}}),
        catalog,
        t
      )
    ).toEqual(['The flips and keywords of the session'])
  })

  test('schedule and budget in words', () => {
    expect(runsLine(agent({schedule: {kind: 'daily', time: '07:30'}}), t)).toBe(
      'Every day at 07:30'
    )
    expect(runsLine(agent({schedule: {kind: 'validation'}}), t)).toBe(
      'At each validation'
    )
    expect(budgetLine(agent(), t)).toBe('Spends no iDNA')
    expect(
      budgetLine(
        agent({
          actions: {like: {level: 'alone', limit: 10}},
          budgetPerDay: 0.05,
        }),
        t
      )
    ).toBe('Up to 0.05 iDNA a day')
    // Only Ask me: nothing spends alone, whatever the overall limit.
    expect(
      budgetLine(
        agent({actions: {like: {level: 'ask', limit: 10}}, budgetPerDay: 1}),
        t
      )
    ).toBe('Spends no iDNA')
    // B-269: the Alone actions' own limits add up (Ask me and Off spend nothing alone); the overall one caps them;
    // one without its own spends up to all of it.
    const actions = {
      like: {level: 'alone', limit: 10, spendPerDay: 0.02},
      tip: {level: 'alone', limit: 5, amount: 1, spendPerDay: 5},
      post: {level: 'ask', limit: null, spendPerDay: 7},
      reply: {level: 'off', limit: 5, spendPerDay: 9},
    }
    expect(budgetLine(agent({actions, budgetPerDay: null}), t)).toBe(
      'Up to 5.02 iDNA a day'
    )
    expect(
      budgetLine(agent({actions: {post: actions.post}, budgetPerDay: null}), t)
    ).toBe('Spends no iDNA')
    expect(budgetLine(agent({actions, budgetPerDay: 1}), t)).toBe(
      'Up to 1 iDNA a day'
    )
    expect(
      budgetLine(
        agent({
          actions: {...actions, post: {level: 'alone', limit: null}},
          budgetPerDay: 8,
        }),
        t
      )
    ).toBe('Up to 8 iDNA a day')
  })

  test('the validation answers can be added only while no other agent holds them', () => {
    const holder = agent({
      id: 'v',
      name: 'Validation agent',
      actions: {answerFlip: {level: 'alone'}},
    })
    const other = agent({id: 'o'})
    expect(heldBy('answerFlip', other, [holder, other])).toBe(
      'Validation agent'
    )
    expect(heldBy('answerFlip', holder, [holder, other])).toBeNull()
    expect(heldBy('report', other, [holder, other])).toBeNull()
  })

  test('the Activity names what was done to the agents', () => {
    const line = (decision) => activityText({action: 'settings', decision}, t)
    expect(line('added')).toBe('Agent added')
    expect(line('removed')).toBe('Agent removed')
    expect(line('paused')).toBe('All agents paused')
    expect(line('resumed')).toBe('All agents resumed')
    expect(line('saved')).toBe('Settings saved')
  })

  test("To approve's steps read as words in Activity", () => {
    const line = (decision, detail = '') =>
      activityText({action: 'post', decision, detail}, t)
    expect(line('ask')).toBe('Post on Social: waits for your approval')
    expect(line('approved', 'posted')).toBe(
      'Post on Social: done after your approval (posted)'
    )
    expect(line('approved')).toBe('Post on Social: done after your approval')
    expect(line('declined')).toBe('Post on Social: declined by you')
    expect(line('dropped', 'action off')).toBe(
      'Post on Social: taken off To approve (action off)'
    )
    // The validation's own lines keep their words.
    expect(
      activityText(
        {action: 'answerFlip', decision: 'ask', detail: 'left 0.80'},
        t
      )
    ).toBe('Answered a flip: left 0.80')
  })

  test("the menu's dot: orange while an action waits, green while an agent is on, none otherwise", () => {
    const list = (agents, paused = false) => ({paused, agents})
    expect(agentsDot(list([agent()]), 2)).toBe('waiting')
    expect(agentsDot(list([agent()]), 0)).toBe('on')
    expect(agentsDot(list([agent()], true), 0)).toBeNull()
    expect(agentsDot(list([agent({enabled: false})]), 0)).toBeNull()
    expect(agentsDot(null, 0)).toBeNull()
  })

  test('a warning when its Social actions have nothing to act on', () => {
    const off = {
      posts: {window: 'off', count: 10},
      notifications: false,
      messages: false,
    }
    const act = {reply: {level: 'alone'}}
    expect(nothingToActOn({actions: act, reads: off})).toBe(true)
    expect(
      nothingToActOn({actions: act, reads: {...off, notifications: true}})
    ).toBe(false)
    expect(
      nothingToActOn({actions: {post: {level: 'alone'}}, reads: off})
    ).toBe(false)
    expect(nothingToActOn({actions: {reply: {level: 'off'}}, reads: off})).toBe(
      false
    )
  })

  test('the budget counts only the actions that spend iDNA', () => {
    const names = (actions) =>
      spendingActions(agent({actions}), catalog).map(({id}) => id)
    expect(
      names({answerFlip: {level: 'alone'}, report: {level: 'alone'}})
    ).toEqual([])
    expect(names({flipStory: {level: 'alone'}})).toEqual([])
    expect(
      names({post: {level: 'off'}, tip: {level: 'alone'}, answerFlip: {}})
    ).toEqual(['post', 'tip'])
  })

  test('Report flips is added alone; only one agent answers, only one reports', () => {
    const report = catalog.find(({id}) => id === 'report')
    expect(report.needs).toBeUndefined()
    const one = agent({id: 'a', name: 'Solver', actions: {answerFlip: {}}})
    const two = agent({id: 'b', name: 'Checker', actions: {report: {}}})
    const three = agent({id: 'c'})
    expect(heldBy('report', three, [one, two, three])).toBe('Checker')
    expect(heldBy('answerFlip', three, [one, two, three])).toBe('Solver')
    expect(heldBy('report', two, [one, two, three])).toBeNull()
    expect(heldBy('post', three, [one, two, three])).toBeNull()
  })
})
