const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {pagesOf} = require('./internet')
const {ask} = require('./providers')
const {createAgent} = require('./agent')
const {
  createAgentProfiles,
  normalizeAgent,
  validationAgentSettings,
} = require('./profiles')
const {exportAgent, readAgentFile} = require('./agent-file')

// B-296: the pages an answer opened (web fetch) named in Activity beside its searches, and an agent file that asks
// for the internet said so before the import.

const ID = 'dddddddddddddddd'
const usage = (searches, pages) => ({
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    // As the API answered on 2026-11-18 (a web fetch of example.com).
    server_tool_use: {
      web_search_requests: searches,
      web_fetch_requests: pages,
    },
  },
})

describe('the pages an answer opened (B-296)', () => {
  test('read from the usage, 0 without it', () => {
    expect(pagesOf(usage(0, 2))).toBe(2)
    expect(pagesOf(usage(1, 0))).toBe(0)
    expect(pagesOf({usage: {input_tokens: 1}})).toBe(0)
    expect(pagesOf(null)).toBe(0)
  })

  test('each request of the answer tells its pages', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        data: {
          ...usage(1, 1),
          stop_reason: 'pause_turn',
          content: [{type: 'server_tool_use', id: 's1', name: 'web_fetch'}],
        },
      })
      .mockResolvedValueOnce({
        data: {
          ...usage(0, 2),
          stop_reason: 'end_turn',
          content: [{type: 'text', text: 'done'}],
        },
      })
    const pages = []
    const searches = []
    await expect(
      ask(
        {
          provider: 'anthropic',
          address: 'https://api.anthropic.com',
          model: 'm',
          key: 'k',
        },
        's',
        [{type: 'text', text: 'q'}],
        {
          request,
          onSearches: (n) => searches.push(n),
          onPages: (n) => pages.push(n),
        }
      )
    ).resolves.toBe('done')
    expect(pages).toEqual([1, 2])
    expect(searches).toEqual([1, 0])
  })

  describe('in Activity', () => {
    let dir
    let model
    const start = () => {
      fs.writeJsonSync(path.join(dir, 'agents.json'), {
        v: 1,
        paused: false,
        agents: [
          {
            id: ID,
            name: 'Oracle',
            enabled: true,
            provider: 'anthropic',
            model: 'm',
            instructions: 'Answer.',
            actions: {reply: {level: 'alone', limit: 5}},
            internet: {mode: 'pages', perAnswer: 3, perDay: 10},
          },
        ],
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
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pages-'))
    })
    afterEach(() => fs.removeSync(dir))

    const lines = async (agent) =>
      (await agent.handle('activity', {agentId: ID}))
        .filter((l) => l.action === 'webSearch')
        .map((l) => l.detail)

    test('beside the searches; a page alone named too; neither, no line', async () => {
      model = jest
        .fn()
        .mockImplementationOnce(async (_c, _s, _p, {onSearches, onPages}) => {
          onSearches(1)
          onPages(2)
          return '{"actions": []}'
        })
        .mockImplementationOnce(async (_c, _s, _p, {onPages}) => {
          onPages(1)
          return '{"actions": []}'
        })
        .mockImplementationOnce(async () => '{"actions": []}')
      const agent = start()
      await agent.handle('planSocial', {agentId: ID, input: 'x'})
      await agent.handle('planSocial', {agentId: ID, input: 'x'})
      await agent.handle('planSocial', {agentId: ID, input: 'x'})
      expect((await lines(agent)).sort()).toEqual(
        ['1 page opened', '1 search, 2 pages opened'].sort()
      )
      // Pages are not searches: the day's searches count only the one.
      const [, , , options] = model.mock.calls[2]
      expect(options.tools[0].max_uses).toBe(3)
    })
  })
})

describe('the import says the file asked for the internet (B-296)', () => {
  test('its mode, null for Off', () => {
    const asked = (internet) =>
      readAgentFile(
        exportAgent(
          normalizeAgent({
            name: 'Oracle',
            provider: 'anthropic',
            model: 'm',
            internet,
          })
        )
      )
    const pages = asked({mode: 'pages'})
    expect(pages.askedInternet).toBe('pages')
    expect(pages.agent.internet.mode).toBe('off')
    expect(asked({mode: 'search'}).askedInternet).toBe('search')
    expect(asked(undefined).askedInternet).toBeNull()
  })
})
