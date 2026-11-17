import {evaluateErrorText, judgeAgentOf, statusLines} from './agent-note'

// B-284: the lines a draft's card shows of the agents' work.

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key]))
const failed = {pass: false, found: false, shown: true, reasons: []}

describe("a draft card's agent lines", () => {
  test('nothing for a flip no agent touched', () => {
    expect(statusLines(null, t)).toEqual([])
  })

  test("the person's own draft: its verdict in words", () => {
    expect(
      statusLines({step: null, verdict: {pass: true}, rewrites: 0}, t)
    ).toEqual([
      {text: 'Passes: the story is found, both keywords shown', bad: false},
    ])
  })

  test("an agent's draft: its step, a failure's reasons, its rewrites", () => {
    expect(
      statusLines({step: 'pictures', verdict: null, rewrites: 1}, t)
    ).toEqual([
      {text: 'Story written, pictures next', bad: false},
      {text: 'Rewrites so far: 1', bad: false},
    ])
    expect(
      statusLines({step: 'left', verdict: failed, rewrites: 2}, t)
    ).toEqual([
      {text: 'Failed after its rewrites, left to you', bad: true},
      {text: "Fails: the story's order was not found", bad: true},
      {text: 'Rewrites so far: 2', bad: false},
    ])
    // Passed and waiting to be sent: the step says it, the verdict is not said twice.
    expect(
      statusLines({step: 'sending', verdict: {pass: true}, rewrites: 0}, t)
    ).toEqual([{text: 'Evaluation passed, sending next', bad: false}])
    // A verdict waiting in To approve is not shown as settled.
    expect(
      statusLines(
        {step: 'approval', verdict: {...failed, waiting: 'i'}, rewrites: 0},
        t
      )
    ).toEqual([{text: 'Waits in To approve', bad: false}])
  })
})

describe('Evaluate', () => {
  const agent = (over) => ({
    id: 'a',
    enabled: true,
    actions: {flipJudge: {level: 'ask'}},
    ...over,
  })

  test('asks the first agent on that judges flips; none when paused or Off', () => {
    const off = agent({id: 'off', actions: {flipJudge: {level: 'off'}}})
    const stopped = agent({id: 'stopped', enabled: false})
    expect(
      judgeAgentOf({paused: false, agents: [off, stopped, agent()]}).id
    ).toBe('a')
    expect(judgeAgentOf({paused: true, agents: [agent()]})).toBeNull()
    expect(judgeAgentOf({paused: false, agents: [off]})).toBeNull()
    expect(judgeAgentOf(null)).toBeNull()
  })

  test('says why a draft was not evaluated', () => {
    expect(evaluateErrorText(new Error('not ready'), t)).toMatch(
      /^Protect and shuffle/
    )
    expect(evaluateErrorText(new Error('waiting'), t)).toBe(
      'This draft waits in To approve.'
    )
    expect(evaluateErrorText(new Error('no answer'), t)).toBe('no answer')
  })
})
