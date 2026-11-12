const {createAgent} = require('./agent')
const {normalizeSettings} = require('./settings')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64')
const flip = {
  images: [PNG, PNG, PNG, PNG],
  orders: [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
  words: [{name: 'sign', desc: 'omen'}],
}

function setup(saved = {}, reply = '{"answer":"left","confidence":0.8}') {
  let value = normalizeSettings({
    enabled: true,
    model: 'm',
    provider: 'openai',
    address: 'https://x.test/v1',
    ...saved,
  })
  const settings = {
    read: () => value,
    write: (next) => {
      value = normalizeSettings(next)
      return value
    },
  }
  const key = {
    keychain: () => ({available: true, reason: null}),
    has: () => true,
    read: () => 'sk-secret',
    set: jest.fn(),
    clear: jest.fn(),
  }
  const ask = jest.fn().mockResolvedValue(reply)
  const agent = createAgent({settings, key, ask, now: () => 1})
  return {agent, ask, key, settings}
}

describe('the agent channel', () => {
  test('an unknown command is refused', async () => {
    const {agent} = setup()
    await expect(agent.handle('constructor')).rejects.toThrow('unknown')
    await expect(agent.handle('readKey')).rejects.toThrow('unknown')
  })

  test('the status never holds the key', async () => {
    const {agent} = setup()
    const status = await agent.handle('status')
    expect(JSON.stringify(status)).not.toContain('sk-secret')
    expect(status).toMatchObject({hasKey: true, keychain: {available: true}})
  })

  test('the model is not asked when the action is off', async () => {
    const {agent, ask} = setup({permissions: {answerFlip: {level: 'off'}}})
    await expect(agent.handle('solveFlip', {flip})).resolves.toMatchObject({
      decision: 'off',
    })
    const {agent: off, ask: askOff} = setup({enabled: false})
    await off.handle('solveFlip', {flip})
    expect(ask).not.toHaveBeenCalled()
    expect(askOff).not.toHaveBeenCalled()
  })

  test('ask me: the answer comes back as a suggestion', async () => {
    const {agent, ask} = setup()
    const result = await agent.handle('solveFlip', {flip, timeoutMs: 10})
    expect(result).toMatchObject({
      decision: 'ask',
      answer: 'left',
      report: false,
    })
    expect(ask.mock.calls[0][0]).toMatchObject({key: 'sk-secret', model: 'm'})
    expect(ask.mock.calls[0][3].timeoutMs).toBe(1000)
  })

  test('alone: the answer applied, a sure report checked against its own row', async () => {
    const reply =
      '{"answer":"right","confidence":0.95,"keywords":"not shown","report":true}'
    const {agent} = setup(
      {
        permissions: {
          answerFlip: {level: 'alone'},
          report: {level: 'alone', limit: 1},
        },
      },
      reply
    )
    await expect(
      agent.handle('solveFlip', {flip, reportsUsed: 0})
    ).resolves.toMatchObject({
      decision: 'alone',
      answer: 'right',
      report: true,
      relevance: 'irrelevant',
      reportDecision: 'alone',
    })
    await expect(
      agent.handle('solveFlip', {flip, reportsUsed: 1})
    ).resolves.toMatchObject({report: true, reportDecision: 'ask'})
  })

  test('a report the row turns off is not sent, nor its relevance', async () => {
    const reply =
      '{"answer":"right","confidence":0.95,"keywords":"not shown","report":true}'
    const {agent} = setup({permissions: {report: {level: 'off'}}}, reply)
    await expect(agent.handle('solveFlip', {flip})).resolves.toMatchObject({
      report: false,
      relevance: null,
      reportDecision: 'off',
    })
  })

  test('pausing stops the question in flight', async () => {
    const {agent, ask} = setup()
    let signal
    ask.mockImplementation(
      (config, system, parts, options) =>
        new Promise((resolve, reject) => {
          ;({signal} = options)
          signal.addEventListener('abort', () =>
            reject(new Error('no answer before the deadline'))
          )
        })
    )
    const pending = agent.handle('solveFlip', {flip})
    await Promise.resolve()
    const status = await agent.handle('saveSettings', {
      ...(await agent.handle('status')).settings,
      paused: true,
    })
    expect(status.settings.paused).toBe(true)
    await expect(pending).rejects.toThrow('deadline')
    expect(signal.aborted).toBe(true)
  })

  test('the activity log keeps what was done, newest first, without pictures', async () => {
    const {agent} = setup()
    await agent.handle('solveFlip', {flip})
    await agent.handle('clearKey')
    const activity = await agent.handle('activity')
    expect(activity.map((x) => x.action)).toEqual(['key', 'answerFlip'])
    expect(JSON.stringify(activity)).not.toContain(PNG)
  })

  test('a test asks the model even with the agent off', async () => {
    const {agent, ask} = setup({enabled: false})
    await expect(agent.handle('testFlip', {flip})).resolves.toMatchObject({
      answer: 'left',
    })
    expect(ask).toHaveBeenCalled()
  })
})
