const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {
  MAX_AGENTS,
  agentSettings,
  createAgentProfiles,
  fromSingleAgent,
  normalizeAgent,
  normalizeAgents,
  validationAgent,
  validationAgentSettings,
} = require('./profiles')
const {
  DEFAULT_ADDRESSES,
  createAgentSettings,
  defaultSettings,
} = require('./settings')
const {checkAction} = require('./permissions')
const {REPORT_THRESHOLDS} = require('./flips')

const ids = () => {
  let n = 0
  return () => {
    n += 1
    return n.toString(16).padStart(16, '0')
  }
}

describe('agent profiles', () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-profiles-'))
  })
  afterEach(() => fs.removeSync(dir))

  test("the model's longest answer and effort: checked, a broken one the app's or the model's default", () => {
    expect(normalizeAgent({maxTokens: '2048', effort: 'xhigh'})).toMatchObject({
      maxTokens: 2048,
      effort: 'xhigh',
    })
    expect(normalizeAgent({maxTokens: 999999}).maxTokens).toBe(128000)
    for (const maxTokens of [0, -5, 1.5, 'many', '', null, true]) {
      expect(normalizeAgent({maxTokens}).maxTokens).toBeNull()
    }
    for (const effort of ['extreme', 'LOW', 3, null]) {
      expect(normalizeAgent({effort}).effort).toBe('')
    }
  })

  test('a new agent is off, with no action, run by hand', () => {
    const agent = normalizeAgent({name: 'Joke agent'}, {id: ids()})
    expect(agent).toEqual({
      id: '0000000000000001',
      name: 'Joke agent',
      enabled: false,
      provider: 'local',
      address: DEFAULT_ADDRESSES.local,
      model: '',
      imageModel: '',
      instructions: '',
      actions: {},
      schedule: {kind: 'manual', time: '09:00'},
      budgetPerDay: null,
      maxTokens: null,
      effort: '',
      reportThresholds: REPORT_THRESHOLDS,
      // Reads nothing and runs on no event until the person says so (B-255).
      reads: {
        posts: {window: 'off', count: 10},
        own: false,
        notifications: false,
        messages: false,
        tags: null,
      },
      events: [],
      flipSteps: true,
    })
    // What it reads and its events: each field checked (B-255).
    expect(
      normalizeAgent({
        reads: {
          posts: {window: 'count', count: 500},
          notifications: 'yes',
          messages: true,
        },
        events: ['tip', 'launch', 'tip', 'message'],
      })
    ).toMatchObject({
      reads: {
        posts: {window: 'count', count: 10},
        notifications: false,
        messages: true,
      },
      events: ['tip', 'message'],
    })
    expect(
      normalizeAgent({reads: {posts: {window: 'week', count: 3}}}).reads.posts
    ).toEqual({window: 'off', count: 10})
    // B-262: reads saved apart (B-255) become read actions, once; the reads are then derived from them.
    const migrated = normalizeAgent({
      actions: {post: {level: 'alone'}, reply: {level: 'ask'}},
      reads: {
        posts: {window: 'count', count: 7},
        notifications: true,
        messages: false,
      },
    })
    expect(migrated.actions).toEqual({
      post: {level: 'alone', limit: null, spendPerDay: null},
      reply: {level: 'ask', limit: 5, spendPerDay: null},
      readPosts: {level: 'alone', limit: null, window: 'count', count: 7},
      readOwnPosts: {level: 'alone', limit: null},
      readNotifications: {level: 'alone', limit: null},
    })
    expect(migrated.reads).toEqual({
      posts: {window: 'count', count: 7},
      own: true,
      notifications: true,
      messages: false,
      tags: null,
    })
    // The posts that tag it (B-264): its questions a day (none: no limit), whose, and the event they start.
    const answering = normalizeAgent({
      events: ['tag', 'week'],
      actions: {
        readTags: {level: 'alone', limit: 3, who: {states: ['Human', 'x']}},
      },
    })
    expect(answering.reads.tags).toEqual({perDay: 3})
    expect(answering.actions.readTags.who.states).toEqual(['Human'])
    expect(answering.events).toEqual(['tag'])
    expect(
      normalizeAgent({actions: {readTags: {level: 'alone', limit: null}}}).reads
        .tags
    ).toEqual({perDay: null})
    expect(
      normalizeAgent({actions: {readTags: {level: 'off', limit: 3}}}).reads.tags
    ).toBe(null)
    // A part of a question is none.
    expect(
      normalizeAgent({actions: {readTags: {level: 'alone', limit: 2.5}}}).reads
        .tags
    ).toEqual({perDay: 2})
    // Once they are actions, a read turned off stays off (no migration again).
    const off = normalizeAgent({
      ...migrated,
      actions: {...migrated.actions, readNotifications: {level: 'off'}},
    })
    expect(off.reads.notifications).toBe(false)
    expect(normalizeAgent(off).actions.readNotifications.level).toBe('off')
    // A read removed (its row gone) stays gone: the reads saved beside are this build's, no migration again.
    const removed = {...off.actions}
    delete removed.readOwnPosts
    delete removed.readPosts
    delete removed.readNotifications
    const saved = normalizeAgent({...off, actions: removed})
    expect(Object.keys(saved.actions)).toEqual(['post', 'reply'])
    expect(normalizeAgent(saved).actions).not.toHaveProperty('readOwnPosts')
    // An agent saved before it had reads (B-239) reads what it read then.
    expect(
      normalizeAgent({
        actions: {reply: {level: 'alone'}, message: {level: 'ask'}},
      }).reads
    ).toEqual({
      posts: {window: 'count', count: 20},
      own: false,
      notifications: true,
      messages: true,
      tags: null,
    })
    // A joke agent (B-237) read its tips, not others' posts.
    expect(
      normalizeAgent({task: 'joke', actions: {post: {level: 'alone'}}}).reads
    ).toEqual({
      posts: {window: 'off', count: 10},
      own: true,
      notifications: true,
      messages: false,
      tags: null,
    })
    // Only actions not Off count; Post alone reads no notifications.
    expect(
      normalizeAgent({
        actions: {reply: {level: 'alone'}, message: {level: 'off'}},
      }).reads.messages
    ).toBe(false)
    expect(normalizeAgent({actions: {post: {level: 'alone'}}}).reads).toEqual({
      posts: {window: 'count', count: 20},
      own: true,
      notifications: false,
      messages: false,
      tags: null,
    })
    expect(
      normalizeAgent({actions: {post: {level: 'off'}}}).reads.posts.window
    ).toBe('off')
    expect(
      normalizeAgent({actions: {answerFlip: {level: 'alone'}}}).reads
    ).toEqual({
      posts: {window: 'off', count: 10},
      own: false,
      notifications: false,
      messages: false,
      tags: null,
    })
    // The daily joke's routine is gone (B-255): a saved task is not kept.
    expect(normalizeAgent({task: 'joke'})).not.toHaveProperty('task')
  })

  test('each field is checked: unknown actions, levels, times and budgets fall back', () => {
    const agent = normalizeAgent({
      id: 'not-an-id',
      name: '  ',
      enabled: 'yes',
      provider: 'anthropic',
      actions: {
        post: {level: 'alone', limit: 1},
        tip: {level: 'sometimes'},
        launchRockets: {level: 'alone'},
        send: 'alone',
      },
      schedule: {kind: 'weekly', time: '25:00'},
      budgetPerDay: -3,
    })
    expect(agent.id).toMatch(/^[0-9a-f]{16}$/u)
    expect(agent.name).toBe('Agent')
    expect(agent.enabled).toBe(false)
    expect(agent.address).toBe(DEFAULT_ADDRESSES.anthropic)
    expect(agent.actions).toEqual(
      // Plus the read actions an old file's Social actions bring (B-262), tested apart.
      expect.objectContaining({
        post: {level: 'alone', limit: 1, spendPerDay: null},
        tip: {level: 'off', limit: 0, amount: 1, spendPerDay: null},
      })
    )
    expect(agent.schedule).toEqual({kind: 'manual', time: '09:00'})
    expect(agent.budgetPerDay).toBeNull()
    expect(
      normalizeAgent({
        schedule: {kind: 'daily', time: '07:30'},
        budgetPerDay: 0.05,
      })
    ).toMatchObject({
      schedule: {kind: 'daily', time: '07:30'},
      budgetPerDay: 0.05,
    })
  })

  test('one agent answers the validation: a second one listing it loses it', () => {
    const file = normalizeAgents({
      agents: [
        {id: 'a'.repeat(16), actions: {post: {level: 'ask'}}},
        {id: 'b'.repeat(16), actions: {answerFlip: {level: 'alone'}}},
        {
          id: 'c'.repeat(16),
          actions: {answerFlip: {level: 'ask'}, report: {level: 'ask'}},
        },
      ],
    })
    expect(file.agents[1].actions.answerFlip.level).toBe('alone')
    expect(file.agents[2].actions).toEqual({
      report: {level: 'ask', limit: null},
    })
    expect(validationAgent(file).id).toBe('b'.repeat(16))
    expect(validationAgent(normalizeAgents({agents: [{}]}))).toBeNull()
  })

  test('ids are unique and the number of agents is capped', () => {
    const same = {id: 'd'.repeat(16)}
    const file = normalizeAgents({agents: [same, same]})
    expect(file.agents[0].id).toBe('d'.repeat(16))
    expect(file.agents[1].id).not.toBe('d'.repeat(16))
    const many = normalizeAgents({
      agents: Array.from({length: MAX_AGENTS + 5}, () => ({})),
    })
    expect(many.agents).toHaveLength(MAX_AGENTS)
  })

  test('an action outside the agent list is refused by the permission check', () => {
    const file = normalizeAgents({
      agents: [
        {
          enabled: true,
          actions: {post: {level: 'alone', limit: null}},
        },
      ],
    })
    const settings = agentSettings(file, file.agents[0])
    expect(checkAction(settings, 'post').decision).toBe('alone')
    expect(checkAction(settings, 'send', {amount: 1})).toEqual({
      decision: 'off',
      reason: 'action off',
    })
    expect(checkAction(settings, 'answerFlip').decision).toBe('off')
    // The pause is shared by every agent.
    const paused = agentSettings({...file, paused: true}, file.agents[0])
    expect(checkAction(paused, 'post')).toEqual({
      decision: 'off',
      reason: 'paused',
    })
  })

  test('the single agent setup reads as one Validation agent', () => {
    const file = fromSingleAgent({
      enabled: true,
      paused: true,
      provider: 'anthropic',
      address: 'https://api.anthropic.com',
      model: 'claude-opus-5-5',
      permissions: {
        answerFlip: {level: 'alone', limit: null},
        report: {level: 'off', limit: null},
        tip: {level: 'ask', limit: 2},
      },
      reportThresholds: {1: 0.6},
    })
    expect(file.paused).toBe(true)
    expect(file.agents).toHaveLength(1)
    const [agent] = file.agents
    expect(agent).toMatchObject({
      name: 'Validation agent',
      enabled: true,
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      schedule: {kind: 'validation', time: '09:00'},
    })
    // The validation's two actions at their levels, Off included; the rest only when it was not Off.
    expect(agent.actions).toEqual(
      // Plus the read actions an old file's Social actions bring (B-262), tested apart.
      expect.objectContaining({
        answerFlip: {level: 'alone', limit: null},
        report: {level: 'off', limit: null},
        tip: {level: 'ask', limit: 2, amount: 1, spendPerDay: null},
      })
    )
    expect(agent.reportThresholds[1]).toBe(0.6)
    // The permission check reads the same answer as from the old setup.
    expect(
      checkAction(agentSettings({...file, paused: false}, agent), 'answerFlip')
        .decision
    ).toBe('alone')
  })

  test('a single agent setup never used gives no agent', () => {
    expect(fromSingleAgent({}).agents).toEqual([])
    expect(fromSingleAgent(null).agents).toEqual([])
  })

  test('the file: none yet reads the single agent setup, which stays as it was', () => {
    const file = path.join(dir, 'agents.json')
    const single = path.join(dir, 'settings.json')
    const old = {
      enabled: true,
      provider: 'anthropic',
      model: 'm',
      permissions: {answerFlip: {level: 'ask'}},
    }
    fs.writeJsonSync(single, old)
    const store = createAgentProfiles({
      file: () => file,
      singleFile: () => single,
    })
    const read = store.read()
    expect(read.agents.map((agent) => agent.name)).toEqual(['Validation agent'])
    expect(fs.existsSync(file)).toBe(false)
    // The first change writes the file of agents; the older build's file is not touched.
    const written = store.write({
      ...read,
      agents: [...read.agents, {name: 'Joke agent'}],
    })
    expect(written.agents.map((agent) => agent.name)).toEqual([
      'Validation agent',
      'Joke agent',
    ])
    expect(store.read()).toEqual(written)
    expect(fs.readJsonSync(single)).toEqual(old)
  })

  test('the file: an unreadable one does not bring the older setup back', () => {
    const file = path.join(dir, 'agents.json')
    const single = path.join(dir, 'settings.json')
    fs.writeJsonSync(single, {enabled: true, provider: 'anthropic'})
    fs.writeFileSync(file, '{broken')
    const warn = jest.fn()
    const store = createAgentProfiles({
      file: () => file,
      singleFile: () => single,
      logger: {warn},
    })
    expect(store.read().agents).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  test('the file: nothing saved at all reads as no agent', () => {
    const store = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
      singleFile: () => path.join(dir, 'settings.json'),
    })
    expect(store.read()).toEqual({v: 1, paused: false, agents: []})
  })

  describe('the validation agent as the single agent settings', () => {
    const files = () => ({
      file: () => path.join(dir, 'agents.json'),
      singleFile: () => path.join(dir, 'settings.json'),
    })

    test('an old setup reads back as it was read before', () => {
      const old = {
        enabled: true,
        paused: false,
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        permissions: {answerFlip: {level: 'alone'}, report: {level: 'ask'}},
        reportThresholds: {1: 0.6, 5: 0.95},
      }
      fs.writeJsonSync(path.join(dir, 'settings.json'), old)
      const before = createAgentSettings({file: files().singleFile}).read()
      const view = validationAgentSettings(createAgentProfiles(files()))
      expect(view.read()).toEqual(before)
    })

    test('no agent: the defaults, off', () => {
      const view = validationAgentSettings(createAgentProfiles(files()))
      expect(view.read()).toEqual(defaultSettings())
    })

    test('a save with no agent yet adds the Validation agent', () => {
      const profiles = createAgentProfiles(files())
      const view = validationAgentSettings(profiles)
      const saved = view.write({
        ...defaultSettings(),
        enabled: true,
        provider: 'anthropic',
        model: 'm',
        permissions: {
          ...defaultSettings().permissions,
          answerFlip: {level: 'ask', limit: null},
        },
      })
      expect(saved.enabled).toBe(true)
      expect(saved.permissions.answerFlip.level).toBe('ask')
      const [agent] = profiles.read().agents
      expect(agent).toMatchObject({
        name: 'Validation agent',
        schedule: {kind: 'validation', time: '09:00'},
      })
      expect(Object.keys(agent.actions).sort()).toEqual([
        'answerFlip',
        'report',
      ])
    })

    test('a save changes the validation agent only: its other actions and the other agents stay', () => {
      const profiles = createAgentProfiles(files())
      profiles.write({
        agents: [
          {name: 'Joke agent', enabled: true, actions: {post: {level: 'ask'}}},
          {
            name: 'Validation agent',
            actions: {
              answerFlip: {level: 'ask'},
              tip: {level: 'ask', limit: 1},
            },
          },
        ],
      })
      const view = validationAgentSettings(profiles)
      view.write({
        ...view.read(),
        enabled: true,
        paused: true,
        permissions: {
          ...view.read().permissions,
          answerFlip: {level: 'alone', limit: null},
        },
      })
      const file = profiles.read()
      expect(file.paused).toBe(true)
      expect(file.agents[0]).toMatchObject({
        name: 'Joke agent',
        actions: {post: {level: 'ask', limit: null}},
      })
      expect(file.agents[1].enabled).toBe(true)
      expect(file.agents[1].actions).toEqual(
        // Plus the read actions an old file's Social actions bring (B-262), tested apart.
        expect.objectContaining({
          answerFlip: {level: 'alone', limit: null},
          // Not in its list before: read as Off, saved as Off.
          report: {level: 'off', limit: null},
          tip: {level: 'ask', limit: 1, amount: 1, spendPerDay: null},
        })
      )
    })
  })

  describe('from the review', () => {
    test('the agent read from the older setup keeps its id from one read to the next', () => {
      fs.writeJsonSync(path.join(dir, 'settings.json'), {
        enabled: true,
        provider: 'anthropic',
      })
      const store = createAgentProfiles({
        file: () => path.join(dir, 'agents.json'),
        singleFile: () => path.join(dir, 'settings.json'),
      })
      expect(store.read().agents[0].id).toBe(store.read().agents[0].id)
    })

    test('long instructions are cut, not emptied', () => {
      const agent = normalizeAgent({instructions: `  ${'a'.repeat(30000)}`})
      expect(agent.instructions).toHaveLength(20000)
    })

    test('an empty budget field is no budget; a number written as text counts', () => {
      expect(normalizeAgent({budgetPerDay: ''}).budgetPerDay).toBeNull()
      expect(normalizeAgent({budgetPerDay: true}).budgetPerDay).toBeNull()
      expect(normalizeAgent({budgetPerDay: '0.05'}).budgetPerDay).toBe(0.05)
      expect(normalizeAgent({budgetPerDay: 0}).budgetPerDay).toBe(0)
    })

    // B-258: Make the pictures became a right of its own; an agent whose stories drew keeps drawing.
    test('an agent saved before the Flips steps draws with Make the pictures, once', () => {
      const before = {
        name: 'Story agent',
        imageModel: 'gpt-image-1',
        actions: {flipStory: {level: 'alone', limit: null, picturesPerDay: 6}},
      }
      const agent = normalizeAgent(before)
      expect(agent.actions.flipPictures).toEqual({
        level: 'alone',
        limit: null,
        picturesPerDay: 6,
      })
      // A build before B-258 reads its pictures a day on Write flip stories: kept there.
      expect(agent.actions.flipStory).toEqual({
        level: 'alone',
        limit: null,
        picturesPerDay: 6,
      })
      // A build before B-269 kept no pictures a day: none.
      const older = normalizeAgent({
        ...before,
        actions: {flipStory: {level: 'ask', limit: null}},
      })
      expect(older.actions.flipPictures).toEqual({
        level: 'ask',
        limit: null,
        picturesPerDay: null,
      })
      // No image model: its stories never drew, it gets nothing new.
      expect(
        normalizeAgent({...before, imageModel: ''}).actions.flipPictures
      ).toBeUndefined()
      // Saved since: a Make the pictures the person removed stays removed.
      const removed = {...agent, actions: {flipStory: agent.actions.flipStory}}
      expect(normalizeAgent(removed).actions.flipPictures).toBeUndefined()
      // ... and a build before B-258 then draws no picture with its stories (Off the same).
      expect(normalizeAgent(removed).actions.flipStory.picturesPerDay).toBe(0)
      const off = {
        ...agent,
        actions: {
          ...agent.actions,
          flipPictures: {...agent.actions.flipPictures, level: 'off'},
        },
      }
      expect(normalizeAgent(off).actions.flipStory.picturesPerDay).toBe(0)
    })

    test('the file is written whole: nothing left beside it', () => {
      const store = createAgentProfiles({
        file: () => path.join(dir, 'agents.json'),
      })
      store.write({agents: [{name: 'A'}]})
      expect(fs.readdirSync(dir)).toEqual(['agents.json'])
    })
  })
})
