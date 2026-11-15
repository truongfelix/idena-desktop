const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')

// The validation's two actions on their own (B-257): one agent answering and one reporting, the same or two; each
// is asked with its own connection and Instructions, the reporting one only once the flip has its keywords.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')
const longFlip = {
  images: [PNG, PNG, PNG, PNG],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  words: [{name: 'sign', desc: 'omen'}],
}
const shortFlip = {...longFlip, words: []}

const A = 'aaaaaaaaaaaaaaaa'
const R = 'bbbbbbbbbbbbbbbb'
const agentRow = (id, name, model, actions, more = {}) => ({
  id,
  name,
  enabled: true,
  provider: 'local',
  model,
  instructions: `${name} instructions`,
  actions,
  ...more,
})
// The answering model never reports; the reporting one reports reason 1, sure.
const REPLIES = {
  answers: '{"answer":"left","confidence":0.8,"keywords":"shown","reasons":[]}',
  reports:
    '{"answer":"right","confidence":0.6,"keywords":"not shown","reasons":[{"reason":1,"confidence":0.95}]}',
}

describe('the validation answered by one agent, reported by another', () => {
  let dir
  let ask

  const start = (agents) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents,
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      key: {
        keychain: () => ({available: true, reason: null}),
        has: () => false,
        hasAny: () => false,
        read: () => null,
        set: jest.fn(),
        clear: jest.fn(),
      },
      ask,
    })
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-validation-'))
    ask = jest.fn(async (config) => REPLIES[config.model])
  })
  afterEach(() => fs.removeSync(dir))

  test('two agents: the answer from the one answering, the report and the marks from the one reporting', async () => {
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(R, 'Checker', 'reports', {report: {level: 'alone'}}),
    ])
    await expect(
      agent.handle('solveFlip', {flip: longFlip})
    ).resolves.toMatchObject({
      decision: 'alone',
      answers: true,
      answer: 'left',
      report: true,
      reportDecision: 'alone',
      markDecision: 'alone',
    })
    expect(ask.mock.calls.map(([config]) => config.model)).toEqual([
      'answers',
      'reports',
    ])
    // Each with its own Instructions.
    expect(ask.mock.calls[1][1]).toContain('Checker instructions')
    const lines = await agent.handle('activity')
    expect(lines.map(({agentId, action}) => [agentId, action])).toEqual(
      expect.arrayContaining([
        [A, 'answerFlip'],
        [R, 'report'],
      ])
    )
  })

  test('in the short session (no keywords) the reporting agent is not asked', async () => {
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(R, 'Checker', 'reports', {report: {level: 'alone'}}),
    ])
    await expect(
      agent.handle('solveFlip', {flip: shortFlip})
    ).resolves.toMatchObject({answer: 'left', report: false})
    expect(ask).toHaveBeenCalledTimes(1)
  })

  test('only a reporting agent: no answer to give, its report and its side to show', async () => {
    const agent = start([
      agentRow(R, 'Checker', 'reports', {report: {level: 'ask'}}),
    ])
    await expect(
      agent.handle('solveFlip', {flip: longFlip})
    ).resolves.toMatchObject({
      decision: 'ask',
      answers: false,
      answer: 'right',
      report: true,
      reportDecision: 'ask',
    })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  test('one agent doing both is asked once, as before', async () => {
    ask = jest.fn(async () => REPLIES.reports)
    const agent = start([
      agentRow(A, 'Both', 'm', {
        answerFlip: {level: 'ask'},
        report: {level: 'alone'},
      }),
    ])
    await expect(
      agent.handle('solveFlip', {flip: longFlip})
    ).resolves.toMatchObject({
      decision: 'ask',
      answers: true,
      report: true,
      // A report is never more automatic than the same agent's answer.
      reportDecision: 'ask',
      markDecision: 'ask',
    })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  test('a second agent cannot report while another does; the view joins both, an agent off counts as Off', async () => {
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(R, 'Checker', 'reports', {report: {level: 'ask'}}),
    ])
    await expect(
      agent.handle('saveAgent', {
        ...agentRow(A, 'Solver', 'answers', {
          answerFlip: {level: 'alone'},
          report: {level: 'alone'},
        }),
      })
    ).rejects.toThrow('Checker already reports in the validation')
    const {settings} = await agent.handle('status')
    expect(settings.permissions.answerFlip.level).toBe('alone')
    expect(settings.permissions.report.level).toBe('ask')
    const off = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(
        R,
        'Checker',
        'reports',
        {report: {level: 'ask'}},
        {enabled: false}
      ),
    ])
    const view = (await off.handle('status')).settings
    expect(view.permissions.report.level).toBe('off')
    expect(view.enabled).toBe(true)
  })

  test('both models are asked at once: the answer does not wait for the report', async () => {
    let releaseReport
    ask = jest.fn((config) =>
      config.model === 'reports'
        ? new Promise((resolve) => {
            releaseReport = () => resolve(REPLIES.reports)
          })
        : Promise.resolve(REPLIES.answers)
    )
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(R, 'Checker', 'reports', {report: {level: 'alone'}}),
    ])
    const solving = agent.handle('solveFlip', {flip: longFlip})
    await new Promise((resolve) => setImmediate(resolve))
    // The reporting model was asked before the answering one finished.
    expect(ask).toHaveBeenCalledTimes(2)
    releaseReport()
    await expect(solving).resolves.toMatchObject({answer: 'left', report: true})
  })

  test("the answering model fails: the report still comes, with the answer's error", async () => {
    ask = jest.fn(async (config) => {
      if (config.model === 'answers') throw new Error('key revoked')
      return REPLIES.reports
    })
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(R, 'Checker', 'reports', {report: {level: 'alone'}}),
    ])
    await expect(
      agent.handle('solveFlip', {flip: longFlip})
    ).resolves.toMatchObject({
      answers: false,
      report: true,
      answerError: 'key revoked',
    })
  })

  test("the reporting model fails: no mark, never the answering model's opinion in its place", async () => {
    ask = jest.fn(async (config) => {
      if (config.model === 'reports') throw new Error('timeout')
      return REPLIES.answers
    })
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(R, 'Checker', 'reports', {report: {level: 'alone'}}),
    ])
    await expect(
      agent.handle('solveFlip', {flip: longFlip})
    ).resolves.toMatchObject({
      answer: 'left',
      report: false,
      relevance: null,
      markDecision: 'off',
    })
  })

  test('a reporting agent that is off changes nothing for the answering one', async () => {
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(
        R,
        'Checker',
        'reports',
        {report: {level: 'alone'}},
        {enabled: false}
      ),
    ])
    await expect(
      agent.handle('solveFlip', {flip: longFlip})
    ).resolves.toMatchObject({markDecision: 'alone', report: false})
    expect(ask).toHaveBeenCalledTimes(1)
  })

  test('before the keywords, the report is asked later, alone', async () => {
    const agent = start([
      agentRow(A, 'Solver', 'answers', {answerFlip: {level: 'alone'}}),
      agentRow(R, 'Checker', 'reports', {report: {level: 'alone'}}),
    ])
    await expect(
      agent.handle('solveFlip', {flip: {...longFlip, words: []}})
    ).resolves.toMatchObject({reportLater: true, markDecision: 'off'})
    ask.mockClear()
    await expect(
      agent.handle('solveFlip', {flip: longFlip, reportOnly: true})
    ).resolves.toMatchObject({
      answers: false,
      report: true,
      reportLater: false,
    })
    expect(ask.mock.calls.map(([config]) => config.model)).toEqual(['reports'])
  })
})
