const {createAgent, clampTimeout} = require('./agent')
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
    hasAny: () => true,
    read: jest.fn((destination) =>
      destination.provider === 'local' ? null : 'sk-secret'
    ),
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
    expect(status).toMatchObject({
      hasKey: true,
      keyElsewhere: false,
      keychain: {available: true},
    })
  })

  test('a key kept for another service shows, to be removed', async () => {
    const {agent, key} = setup()
    key.has = () => false
    await expect(agent.handle('status')).resolves.toMatchObject({
      hasKey: false,
      keyElsewhere: true,
    })
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
      '{"answer":"right","confidence":0.6,"keywords":"not shown","reasons":[{"reason":1,"confidence":0.95}]}'
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
      '{"answer":"right","confidence":0.6,"keywords":"not shown","reasons":[{"reason":1,"confidence":0.95}]}'
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

  test('the key asked for the provider and address in use, none for a local model', async () => {
    const {agent, ask, key} = setup()
    await agent.handle('solveFlip', {flip})
    expect(key.read).toHaveBeenCalledWith({
      provider: 'openai',
      address: 'https://x.test/v1',
    })
    await agent.handle('setKey', {key: 'sk-new'})
    expect(key.set).toHaveBeenCalledWith('sk-new', {
      provider: 'openai',
      address: 'https://x.test/v1',
    })
    const {agent: local, ask: askLocal} = setup({
      provider: 'local',
      address: 'http://127.0.0.1:11434/v1',
    })
    await local.handle('solveFlip', {flip})
    expect(askLocal.mock.calls[0][0].key).toBeNull()
    expect(ask.mock.calls[0][0].key).toBe('sk-secret')
  })

  test('with answers asked first, a report is asked first too', async () => {
    const reply =
      '{"answer":"right","confidence":0.6,"keywords":"not shown","reasons":[{"reason":1,"confidence":0.95}]}'
    const {agent} = setup(
      {permissions: {answerFlip: {level: 'ask'}, report: {level: 'alone'}}},
      reply
    )
    await expect(agent.handle('solveFlip', {flip})).resolves.toMatchObject({
      decision: 'ask',
      report: true,
      reportDecision: 'ask',
    })
  })

  test('a report count that is not a number is not within the limit', async () => {
    const reply =
      '{"answer":"right","confidence":0.6,"keywords":"not shown","reasons":[{"reason":1,"confidence":0.95}]}'
    const {agent} = setup(
      {
        permissions: {
          answerFlip: {level: 'alone'},
          report: {level: 'alone', limit: 3},
        },
      },
      reply
    )
    for (const reportsUsed of [null, 'x', NaN, -1]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        agent.handle('solveFlip', {flip, reportsUsed})
      ).resolves.toMatchObject({
        reportDecision: 'ask',
      })
    }
  })

  test('a settings change does not cut the practice test; its Stop does', async () => {
    const {agent, ask} = setup({enabled: false})
    ask.mockImplementation(
      (config, system, parts, {signal}) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped')))
          setTimeout(() => resolve('{"answer":"left","confidence":0.7}'), 50)
        })
    )
    const first = agent.handle('testFlip', {flip})
    await agent.handle('saveSettings', {
      ...(await agent.handle('status')).settings,
      model: 'other',
    })
    await expect(first).resolves.toMatchObject({answer: 'left'})
    const second = agent.handle('testFlip', {flip})
    await Promise.resolve()
    await agent.handle('stopTest')
    await expect(second).rejects.toThrow('stopped')
  })

  test('leaving the validation ends its question in flight', async () => {
    const {agent, ask} = setup()
    ask.mockImplementation(
      (config, system, parts, {signal}) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped')))
        })
    )
    const solving = agent.handle('solveFlip', {flip, timeoutMs: 5000})
    await Promise.resolve()
    await agent.handle('stopSolve')
    await expect(solving).rejects.toThrow('stopped')
  })

  test('a deadline that is not a number is the longest one, not 1 s', () => {
    expect(clampTimeout(null)).toBe(120000)
    expect(clampTimeout('')).toBe(120000)
    expect(clampTimeout(undefined)).toBe(120000)
    expect(clampTimeout(30000)).toBe(30000)
    expect(clampTimeout(10)).toBe(1000)
  })
})
