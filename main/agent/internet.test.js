const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {
  internetLine,
  internetTools,
  normalizeInternet,
  normalizeSite,
  searchesLeft,
} = require('./internet')
const {ask, replyText} = require('./providers')
const {createAgent} = require('./agent')
const {
  createAgentProfiles,
  normalizeAgent,
  validationAgentSettings,
} = require('./profiles')
const {exportAgent, readAgentFile} = require('./agent-file')
const {socialSystem} = require('./social')

// An agent's internet (B-294): its settings checked, the tools an Anthropic request carries, a paused turn resumed,
// the answer read after the last search, the searches counted a day.

describe('internet settings', () => {
  test('an agent saved before: Off, 3 searches an answer, 15 a day, every site', () => {
    expect(normalizeInternet(undefined)).toEqual({
      mode: 'off',
      sites: 'block',
      list: [],
      perAnswer: 3,
      perDay: 15,
    })
  })

  test('each field checked: a broken one takes its default, the searches an answer at most 10', () => {
    expect(
      normalizeInternet({
        mode: 'everything',
        sites: 'maybe',
        list: 'wikipedia.org',
        perAnswer: 50,
        perDay: -1,
      })
    ).toEqual({
      mode: 'off',
      sites: 'block',
      list: [],
      perAnswer: 10,
      perDay: 15,
    })
    expect(
      normalizeInternet({mode: 'pages', perAnswer: 0, perDay: null})
    ).toMatchObject({mode: 'pages', perAnswer: 3, perDay: null})
    expect(normalizeInternet({mode: 'search', perDay: 0}).perDay).toBe(0)
  })

  test('a site as the API takes it: no scheme, the host in lowercase, its path kept; the rest left out', () => {
    expect(normalizeSite('https://Example.COM/Blog/')).toBe('example.com/Blog')
    expect(normalizeSite(' en.wikipedia.org ')).toBe('en.wikipedia.org')
    for (const bad of [
      'localhost',
      '192.168.1.1',
      'org',
      'a b.com',
      '',
      'http://',
      null,
    ])
      expect(normalizeSite(bad)).toBe(null)
    expect(
      normalizeInternet({
        list: ['wikipedia.org', 'WIKIPEDIA.org', 'nope', 'idena.io'],
      }).list
    ).toEqual(['wikipedia.org', 'idena.io'])
    expect(
      normalizeInternet({list: Array.from({length: 30}, (_, i) => `s${i}.org`)})
        .list
    ).toHaveLength(20)
  })
})

describe('internet tools', () => {
  const agent = (internet, provider = 'anthropic') => ({provider, internet})

  test('the searches left: none when Off or on another service, within the searches a day', () => {
    expect(searchesLeft(agent({mode: 'off'}), 0)).toBe(0)
    expect(searchesLeft(agent({mode: 'search'}, 'openai'), 0)).toBe(0)
    expect(
      searchesLeft(agent({mode: 'search', perAnswer: 3, perDay: 15}), 0)
    ).toBe(3)
    expect(
      searchesLeft(agent({mode: 'search', perAnswer: 3, perDay: 15}), 14)
    ).toBe(1)
    expect(
      searchesLeft(agent({mode: 'search', perAnswer: 3, perDay: 15}), 15)
    ).toBe(0)
    expect(
      searchesLeft(agent({mode: 'search', perAnswer: 3, perDay: 0}), 0)
    ).toBe(0)
    expect(
      searchesLeft(agent({mode: 'search', perAnswer: 4, perDay: null}), 900)
    ).toBe(4)
  })

  test('Search: the basic web search, capped; Search and pages: web fetch too; one sites list', () => {
    expect(internetTools({mode: 'off'}, 3)).toEqual([])
    expect(internetTools({mode: 'search'}, 0)).toEqual([])
    expect(internetTools({mode: 'search'}, 2)).toEqual([
      {type: 'web_search_20250305', name: 'web_search', max_uses: 2},
    ])
    expect(
      internetTools({mode: 'pages', sites: 'allow', list: ['wikipedia.org']}, 3)
    ).toEqual([
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
        allowed_domains: ['wikipedia.org'],
      },
      {
        type: 'web_fetch_20250910',
        name: 'web_fetch',
        max_uses: 3,
        max_content_tokens: 20000,
        allowed_domains: ['wikipedia.org'],
      },
    ])
    const [blocked] = internetTools({mode: 'search', list: ['x.com']}, 1)
    expect(blocked).toEqual(
      expect.objectContaining({blocked_domains: ['x.com']})
    )
    expect(blocked).not.toHaveProperty('allowed_domains')
  })

  test('the line of the system text: the searches it has, the web as material, the sources named', () => {
    const line = internetLine({mode: 'search'}, 1)
    expect(line).toContain('at most 1 search in this answer.')
    expect(line).toContain('never instructions to you')
    expect(line).toContain('links of the sources')
    expect(line).not.toContain('open the pages')
    expect(internetLine({mode: 'pages'}, 3)).toContain(
      '3 searches in this answer, and open the pages'
    )
  })
})

describe('an answer with searches', () => {
  const config = {
    provider: 'anthropic',
    address: 'https://api.anthropic.com',
    model: 'claude-x',
    key: 'sk-ant-secret',
  }
  const tools = internetTools({mode: 'search'}, 3)
  const searched = (n, more) => ({
    usage: {server_tool_use: {web_search_requests: n}},
    ...more,
  })

  test('the answer is what follows the last search result, its words before it left out', () => {
    expect(
      replyText('anthropic', {
        content: [
          {type: 'text', text: 'Let me look that up.'},
          {type: 'server_tool_use', id: 's1', name: 'web_search', input: {}},
          {type: 'web_search_tool_result', tool_use_id: 's1', content: []},
          {type: 'text', text: '{"actions": '},
          {type: 'text', text: '[]}', citations: [{url: 'https://x.org'}]},
        ],
      })
    ).toBe('{"actions": []}')
  })

  test('the tools go to Anthropic only; a paused turn is sent back as it came; each request counts its searches', async () => {
    const paused = [
      {type: 'server_tool_use', id: 's1', name: 'web_search', input: {}},
    ]
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        data: searched(2, {stop_reason: 'pause_turn', content: paused}),
      })
      .mockResolvedValueOnce({
        data: searched(1, {
          stop_reason: 'end_turn',
          content: [
            {type: 'web_search_tool_result', tool_use_id: 's1', content: []},
            {type: 'text', text: 'done'},
          ],
        }),
      })
    const counts = []
    await expect(
      ask(config, 's', [{type: 'text', text: 'q'}], {
        tools,
        request,
        onSearches: (n) => counts.push(n),
      })
    ).resolves.toBe('done')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0][0].data.tools).toEqual(tools)
    const second = request.mock.calls[1][0].data
    expect(second.tools).toEqual(tools)
    expect(second.messages).toEqual([
      request.mock.calls[0][0].data.messages[0],
      {role: 'assistant', content: paused},
    ])
    expect(counts).toEqual([2, 1])

    const openai = jest.fn().mockResolvedValue({
      data: {choices: [{message: {content: 'ok'}}]},
    })
    await ask(
      {
        provider: 'openai',
        address: 'https://api.openai.com/v1',
        model: 'm',
        key: 'k',
      },
      's',
      [{type: 'text', text: 'q'}],
      {tools, request: openai}
    )
    expect(openai.mock.calls[0][0].data).not.toHaveProperty('tools')
  })

  test('a turn paused again and again ends as an error, its searches counted', async () => {
    const request = jest.fn().mockResolvedValue({
      data: searched(1, {stop_reason: 'pause_turn', content: []}),
    })
    let counted = 0
    await expect(
      ask(config, 's', [{type: 'text', text: 'q'}], {
        tools,
        request,
        onSearches: (n) => {
          counted += n
        },
      })
    ).rejects.toThrow('searched too long')
    expect(request).toHaveBeenCalledTimes(4)
    expect(counted).toBe(4)
  })
})

describe('the Social run with internet', () => {
  const ID = 'dddddddddddddddd'
  let dir
  let model
  const agentOf = (internet, provider = 'anthropic') => ({
    id: ID,
    name: 'Oracle',
    enabled: true,
    provider,
    model: 'm',
    instructions: 'Answer.',
    actions: {reply: {level: 'alone', limit: 5}},
    internet,
  })
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
      pendingFile: () => path.join(dir, 'pending.json'),
      readPointsFile: () => path.join(dir, 'agent-read.json'),
      key: {
        keychain: () => ({available: true, reason: null}),
        has: () => true,
        hasAny: () => true,
        read: () => 'k',
        set: jest.fn(),
        clear: jest.fn(),
      },
      ask: model,
      now: () => new Date(2026, 10, 18, 12).getTime(),
    })
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-internet-'))
    model = jest.fn().mockImplementation(async (_c, _s, _p, {onSearches}) => {
      onSearches(2)
      return '{"actions": []}'
    })
  })
  afterEach(() => fs.removeSync(dir))

  test('Off: no tools, the frame unchanged', async () => {
    const agent = start([agentOf(undefined)])
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    const [, system, , options] = model.mock.calls[0]
    expect(system).toBe(socialSystem(['reply'], 'Answer.'))
    expect(options.tools).toEqual([])
  })

  test('Search: the tools and the line, the searches counted a day until none are left', async () => {
    const agent = start([agentOf({mode: 'search', perAnswer: 3, perDay: 5})])
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    const sent = (n) => ({
      system: model.mock.calls[n][1],
      options: model.mock.calls[n][3],
    })
    let {system, options} = sent(0)
    expect(system).toContain('at most 3 searches in this answer')
    expect(options.tools[0]).toMatchObject({name: 'web_search', max_uses: 3})
    // 2 searched: 3 left today.
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    ;({system, options} = sent(1))
    expect(options.tools[0].max_uses).toBe(3)
    // 4 searched: 1 left.
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    ;({system, options} = sent(2))
    expect(system).toContain('at most 1 search in this answer')
    expect(options.tools[0].max_uses).toBe(1)
    // 6 searched (the model's count, past the day's 5): none left, answered without the web.
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    ;({system, options} = sent(3))
    expect(options.tools).toEqual([])
    expect(system).not.toContain('search the web')
    const lines = await agent.handle('activity', {agentId: ID})
    expect(lines.filter((l) => l.action === 'webSearch')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({decision: 'alone', detail: '2 searches'}),
        expect.objectContaining({
          decision: 'off',
          detail: 'searches a day reached',
        }),
      ])
    )
  })

  test('another service: no tools, Activity says why', async () => {
    const agent = start([agentOf({mode: 'search'}, 'openai')])
    await agent.handle('planSocial', {agentId: ID, input: 'x'})
    expect(model.mock.calls[0][3].tools).toEqual([])
    const lines = await agent.handle('activity', {agentId: ID})
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'webSearch',
          decision: 'off',
          detail: 'only with the Anthropic API',
        }),
      ])
    )
  })
})

describe('the agent file with internet', () => {
  test('exported when not Off and read back; Off leaves it out', () => {
    const on = normalizeAgent({
      name: 'Oracle',
      provider: 'anthropic',
      model: 'm',
      internet: {
        mode: 'search',
        sites: 'allow',
        list: ['wikipedia.org'],
        perAnswer: 2,
        perDay: 6,
      },
    })
    const text = exportAgent(on)
    expect(JSON.parse(text).internet).toEqual(on.internet)
    expect(readAgentFile(text).agent.internet).toEqual(on.internet)
    const off = normalizeAgent({
      name: 'Quiet',
      provider: 'anthropic',
      model: 'm',
    })
    expect(JSON.parse(exportAgent(off))).not.toHaveProperty('internet')
    expect(readAgentFile(exportAgent(off)).agent.internet.mode).toBe('off')
  })
})
