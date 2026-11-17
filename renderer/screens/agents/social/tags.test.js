/* global BigInt */
import os from 'os'
import path from 'path'
import fs from 'fs-extra'
import {tagName, tags, tagsLeftOf} from './tags'
import {MAX_THREAD, socialDigest} from './digest'
import {LIKE} from '../../social/contract'
import {eventPending} from './events'
import {runSocialAgent} from './run'
import {eventsRead} from '../runner'

// The posts that tag an agent (B-264): its questions, at most a number a day for the whole agent (a day in UTC), only
// from the identities its criteria let it read; past them, and for an untagged post, no reply and no model call.

const {createAgent} = require('../../../../main/agent/agent')
const {
  createAgentProfiles,
  validationAgentSettings,
} = require('../../../../main/agent/profiles')

const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const ANN = '0xa110000000000000000000000000000000000001'
const BOB = '0xb0b0000000000000000000000000000000000002'
const CAT = '0xca70000000000000000000000000000000000003'
const ID = 'dddddddddddddddd'
const HEAD = 10000

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))

const node = (id, author, message, height, replies = []) => ({
  id,
  call: {author, message, replyTo: '', height, index: 0, time: height * 20},
  likeCalls: [],
  tips: [],
  replies,
})

const NAMES = {[ME]: '@jokebot', [ANN]: '@ann', [BOB]: '@bob'}

describe('a tag', () => {
  test('"@" and the profile name, a whole word, any case; never an e-mail address or a longer name', () => {
    const name = tagName('@JokeBot')
    expect(name).toBe('jokebot')
    expect(tagName('@no')).toBe(null)
    expect(tagName(undefined)).toBe(null)
    expect(tags('@jokebot what is Idena?', name)).toBe(true)
    expect(tags('Hey @JokeBot, a question', name)).toBe(true)
    expect(tags('(@jokebot)', name)).toBe(true)
    expect(tags('ask @jokebot.', name)).toBe(true)
    expect(tags('@jokebot2 hello', name)).toBe(false)
    expect(tags('mail me@jokebot.com', name)).toBe(false)
    expect(tags('@@jokebot', name)).toBe(false)
    expect(tags('jokebot without the at', name)).toBe(false)
    expect(tags('ipfs://bafy @jokebot', name)).toBe(false)
    // A later one counts when an earlier one is part of a word.
    expect(tags('x@jokebot then @jokebot', name)).toBe(true)
    expect(tags('@jokebot', null)).toBe(false)
  })
})

describe('what a run reads of the posts that tag it', () => {
  const reads = {
    posts: {window: 'count', count: 50},
    notifications: true,
    messages: false,
    tags: {perDay: 5},
  }
  const feed = () => [
    node(40, BOB, 'A post without a tag', 9970),
    node(30, ANN, '@jokebot what is a flip?', 9960),
    node(20, ME, 'Good morning Idena', 9900, [
      node(21, BOB, '@jokebot and the weather?', 9950),
      node(22, CAT, 'thanks!', 9955),
    ]),
  ]
  const social = (more = {}) => ({
    feed: feed(),
    me: ME,
    names: NAMES,
    blocked: new Set(),
    conversations: [],
    ...more,
  })

  test('each with the post it answers; read only as a tag, never as a post or an answer besides', () => {
    const digest = socialDigest(social(), {reads}, {point: 9800, scanned: HEAD})
    expect(digest.text).toContain('Posts that tag you:')
    expect(digest.text).toMatch(
      /p\d by @bob, answering @jokebot \("Good morning Idena"\): "@jokebot and the weather\?"/u
    )
    expect(digest.text).toMatch(/p\d by @ann: "@jokebot what is a flip\?"/u)
    expect(digest.tagsShown).toBe(2)
    // Each tag once, in its own section: the new posts and the answers hold none.
    const [, posts = ''] = digest.text.split('New posts:')
    expect(posts).toContain('A post without a tag')
    expect(posts).not.toContain('@jokebot')
    const answers = digest.text.split('Answers to you:')[1].split('\n\n')[0]
    expect(answers).toContain('thanks!')
    expect(answers).not.toContain('@jokebot')
  })

  test('a tag deep in a thread comes with the thread: its first post and the replies before it, every author (B-290)', () => {
    const DAN = '0xda70000000000000000000000000000000000004'
    const EVE = '0xe7e0000000000000000000000000000000000005'
    const validated = {
      only: [],
      except: [],
      states: ['Newbie', 'Verified', 'Human'],
      trustAbove: null,
      minAge: null,
      minStake: null,
    }
    const facts = {
      [ANN]: {state: 'Human'},
      [BOB]: {state: 'Candidate'},
      [CAT]: {state: 'Undefined'},
    }
    const thread = (tagger) => [
      node(60, CAT, 'Which wallet do you use?', 9900, [
        node(61, BOB, `A long answer ${'x'.repeat(400)}`, 9910, [
          node(62, DAN, 'Blocked words', 9915),
          node(63, ANN, 'I agree with Bob', 9920, [
            node(64, tagger, '@jokebot is Bob right?', 9940),
          ]),
          node(65, EVE, 'A reply after the tag', 9945),
        ]),
        node(66, ME, 'The desktop app', 9925),
        node(67, EVE, LIKE, 9930),
      ]),
    ]
    const run = (tagger) =>
      socialDigest(
        social({feed: thread(tagger), blocked: new Set([DAN])}),
        {
          reads: {...reads, posts: {window: 'off'}, notifications: false},
          who: {tags: validated},
          facts,
        },
        {point: 9800, scanned: HEAD}
      )
    const digest = run(ANN)
    expect(digest.tagsShown).toBe(1)
    const section = digest.text.split('Posts that tag you:')[1]
    // The tag's own line holds the post it answers (Ann's); under it the thread, oldest first: the first post (by an
    // identity outside Whose), Bob's (a Candidate, cut shorter than a post), its own reply; never the blocked one,
    // the like, nor what came after the tag.
    const lines = section.trim().split('\n')
    expect(lines[0]).toMatch(
      /^p\d by @ann, answering @ann \("I agree with Bob"\): "@jokebot is Bob right\?"$/u
    )
    expect(lines.slice(1)).toEqual([
      `  the thread's first post, by 0xca70…0003: "Which wallet do you use?"`,
      `  @bob, answering 0xca70…0003: "A long answer ${'x'.repeat(186)}…"`,
      `  you, answering 0xca70…0003: "The desktop app"`,
    ])
    expect(digest.text).not.toContain('Blocked words')
    expect(digest.text).not.toContain('after the tag')
    // The thread has no labels: the agent can act on the tag alone.
    expect([...digest.labels.keys()]).toEqual(['p1'])
    // The same tag from someone outside Whose is no question: nothing is read, thread or not.
    const outside = run(BOB)
    expect(outside.tagsShown).toBe(0)
    expect(outside.text).not.toContain('Which wallet')
  })

  test('a thread longer than the bound: the first post, then the replies nearest the tag', () => {
    const replies = Array.from({length: 12}, (_, i) =>
      node(80 + i, BOB, `reply ${i}`, 9900 + i)
    )
    const tag = node(99, ANN, '@jokebot sum it up', 9950)
    const long = [
      node(70, CAT, 'The root', 9890, [
        ...replies,
        node(98, BOB, 'the last reply', 9940, [tag]),
      ]),
    ]
    const digest = socialDigest(
      social({feed: long}),
      {reads: {...reads, posts: {window: 'off'}, notifications: false}},
      {point: 9800, scanned: HEAD}
    )
    const lines = digest.text.split('Posts that tag you:')[1].trim().split('\n')
    expect(lines).toHaveLength(1 + MAX_THREAD)
    expect(lines[1]).toContain("the thread's first post")
    expect(lines.slice(2).map((one) => one.split('"')[1])).toEqual(
      [5, 6, 7, 8, 9, 10, 11].map((i) => `reply ${i}`)
    )
  })

  test('past the questions left today: passed over for good, the point goes past them', () => {
    const digest = socialDigest(
      social(),
      {reads, tagsLeft: 1},
      {point: 9800, scanned: HEAD}
    )
    // The oldest first: Bob's (9950) is read, Ann's (9960) is not, and will not be.
    expect(digest.text).toContain('@jokebot and the weather?')
    expect(digest.text).not.toContain('what is a flip')
    expect(digest).toMatchObject({tagsShown: 1, tagsPassed: 1, readTo: HEAD})
    // None left: nothing tags it in what it reads; a post that tags it is never read as a post instead.
    const none = socialDigest(
      social(),
      {reads, tagsLeft: 0},
      {point: 9800, scanned: HEAD}
    )
    expect(none.text).not.toContain('@jokebot what')
    expect(none.text).not.toContain('@jokebot and')
    expect(none.tagsPassed).toBe(2)
  })

  test('without the read, or without a profile name, nothing tags it', () => {
    const off = socialDigest(
      social(),
      {reads: {...reads, tags: null, posts: {window: 'off'}}},
      {point: 9800, scanned: HEAD}
    )
    expect(off.text).not.toContain('Posts that tag you:')
    const nameless = socialDigest(
      social({names: {}}),
      {reads: {...reads, posts: {window: 'off'}, notifications: false}},
      {point: 9800, scanned: HEAD}
    )
    expect(nameless.empty).toBe(true)
  })

  test('a tag starts a run as an event, only from someone else and only once it reads them', () => {
    const at = {point: 9800, scanned: HEAD}
    expect(eventPending(['tag'], social(), at)).toBe(true)
    expect(eventPending(['tag'], social(), {...at, point: 9965})).toBe(false)
    expect(eventPending(['tag'], social({names: {}}), at)).toBe(false)
    expect(
      eventPending(
        ['tag'],
        social({feed: [node(50, ME, '@jokebot my own', 9990)]}),
        at
      )
    ).toBe(false)
    expect(eventsRead({reads: {tags: {perDay: 5}}, events: ['tag']})).toEqual([
      'tag',
    ])
    expect(eventsRead({reads: {tags: null}, events: ['tag']})).toEqual([])
    // Past its questions of the day, or with the day's count unknown, a tag starts no run.
    expect(tagsLeftOf(5, 4)).toBe(1)
    expect(tagsLeftOf(5, 7)).toBe(0)
    expect(tagsLeftOf(null, 50)).toBe(Infinity)
    expect(tagsLeftOf(5, null)).toBe(0)
  })
})

describe('an answering agent on Social (B-264)', () => {
  let dir
  let now
  let ask
  let main

  const VALIDATED = {states: ['Newbie', 'Verified', 'Human']}
  const facts = {
    [ANN]: {state: 'Human', age: 9, stake: 100},
    [BOB]: {state: 'Verified', age: 3, stake: 10},
    [CAT]: {state: 'Candidate', age: 0, stake: 0},
  }

  const boot = () => {
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    main = createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      pendingFile: () => path.join(dir, 'pending.json'),
      readPointsFile: () => path.join(dir, 'agent-read.json'),
      key: {
        keychain: () => ({available: true, reason: null}),
        has: () => false,
        hasAny: () => false,
        read: () => null,
        set: () => {},
        clear: () => {},
      },
      ask,
      now: () => now,
    })
    return profiles.read().agents[0]
  }

  const start = () => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [
        {
          id: ID,
          name: 'Question service',
          enabled: true,
          model: 'claude-haiku-5-5',
          instructions: 'You answer questions for people using Idena.',
          budgetPerDay: 10,
          schedule: {kind: 'hourly'},
          events: ['tag'],
          actions: {
            readTags: {level: 'alone', limit: 5, who: VALIDATED},
            reply: {level: 'alone', limit: 20},
          },
        },
      ],
    })
    return boot()
  }

  const deps = () => {
    const sent = []
    return {
      sent,
      t,
      agent: (command, data) => main.handle(command, data),
      readAuthors: jest.fn(async (addresses) =>
        Object.fromEntries(addresses.map((a) => [a, facts[a] || {}]))
      ),
      prepare: jest.fn(async (item) => ({
        item,
        fee: {maxFee: BigInt(10) ** BigInt(16)},
        files: [],
        socialCall: {amount: '0'},
      })),
      send: jest.fn(async (pending) => {
        sent.push(pending.item)
        return 'block 10001'
      }),
    }
  }

  // The model answers every post it was shown.
  const answerAll = async (connection, system, [{text}]) =>
    JSON.stringify({
      actions: [...text.matchAll(/^(p\d+) by /gmu)].map(([, label]) => ({
        do: 'reply',
        to: label,
        text: 'An answer.',
      })),
    })

  // Seven questions from validated identities (Ann, Bob in turn), one from a Candidate, one post without a tag.
  const questions = (from = 9000) =>
    Array.from({length: 7}, (_, i) =>
      node(
        100 + i,
        i % 2 ? BOB : ANN,
        `@jokebot question ${i + 1}?`,
        from + i * 10
      )
    )
  const social = (feed, head = HEAD) => ({
    feed: [...feed].reverse(),
    me: ME,
    head,
    names: NAMES,
    blocked: new Set(),
    conversations: [],
  })

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tags-'))
    // 2026-11-16 22:30 UTC: 23:30 in Paris, the same day in UTC.
    now = Date.UTC(2026, 10, 16, 22, 30)
    ask = jest.fn(answerAll)
  })
  afterEach(() => fs.removeSync(dir))

  test('a validated identity gets an answer; the 6th question, a Candidate and an untagged post get none, and no model call', async () => {
    const agent = start()
    expect(agent.reads.tags).toEqual({perDay: 5})
    const feed = [
      ...questions(),
      node(200, CAT, '@jokebot me too?', 9005),
      node(201, BOB, 'no tag here, answer me', 9006),
    ]
    const d = deps()
    const first = await runSocialAgent(agent, social(feed), d)
    expect(first).toMatchObject({result: 'done', count: {alone: 5}})
    expect(ask).toHaveBeenCalledTimes(1)
    const [, , [{text}]] = ask.mock.calls[0]
    // The first five validated questions, first come first served; nothing of the Candidate's or the untagged post.
    expect(text).toContain('question 5?')
    expect(text).not.toContain('question 6?')
    expect(text).not.toContain('me too?')
    expect(text).not.toContain('no tag here')
    expect(d.sent.map((item) => item.target.postId)).toEqual([
      100, 101, 102, 103, 104,
    ])
    await expect(main.handle('tagsToday', {agentId: ID})).resolves.toBe(5)
    const lines = (await main.handle('activity', {agentId: ID})).map(
      (line) => line.detail
    )
    expect(lines).toContain('2 past its questions of the day, not read')

    // A new question the same day (UTC), after a restart: no reply, no model call.
    now += 30 * 60 * 1000
    const again = boot()
    const later = [...feed, node(300, ANN, '@jokebot one more?', HEAD + 10)]
    const d2 = deps()
    await expect(
      runSocialAgent(again, social(later, HEAD + 20), d2)
    ).resolves.toMatchObject({result: 'nothing new'})
    expect(ask).toHaveBeenCalledTimes(1)
    expect(d2.sent).toEqual([])

    // The next day in UTC (00:10 UTC): the day's questions start again, with the new ones only.
    now = Date.UTC(2026, 10, 17, 0, 10)
    const next = [...later, node(301, BOB, '@jokebot a new day?', HEAD + 30)]
    const d3 = deps()
    await expect(
      runSocialAgent(boot(), social(next, HEAD + 40), d3)
    ).resolves.toMatchObject({result: 'done', count: {alone: 1}})
    expect(ask).toHaveBeenCalledTimes(2)
    expect(d3.sent.map((item) => item.target.postId)).toEqual([301])
    await expect(main.handle('tagsToday', {agentId: ID})).resolves.toBe(1)
  })

  test('a failed model call counts no question: they are read again by the next run', async () => {
    const agent = start()
    ask.mockRejectedValueOnce(new Error('overloaded'))
    const feed = questions().slice(0, 2)
    await expect(runSocialAgent(agent, social(feed), deps())).rejects.toThrow(
      'overloaded'
    )
    await expect(main.handle('tagsToday', {agentId: ID})).resolves.toBe(0)
    const d = deps()
    await expect(runSocialAgent(agent, social(feed), d)).resolves.toMatchObject(
      {count: {alone: 2}}
    )
    await expect(main.handle('tagsToday', {agentId: ID})).resolves.toBe(2)
  })

  test('the count of the day unread: the run fails before reading, and the questions wait for the next run', async () => {
    const agent = start()
    const d = deps()
    const agentCall = d.agent
    d.agent = (command, data) =>
      command === 'tagsToday'
        ? Promise.reject(new Error('unreadable'))
        : agentCall(command, data)
    await expect(runSocialAgent(agent, social(questions()), d)).rejects.toThrow(
      'unreadable'
    )
    expect(ask).not.toHaveBeenCalled()
    await expect(main.handle('readPoint', {agentId: ID})).resolves.toBe(null)
    const lines = (await main.handle('activity', {agentId: ID})).map(
      (line) => line.detail
    )
    expect(lines.join('\n')).not.toContain('past its questions')
  })

  test('a line of Activity that cannot be written stops no answer', async () => {
    const agent = start()
    const d = deps()
    const agentCall = d.agent
    d.agent = (command, data) =>
      command === 'didAction' && data.action === 'readTags'
        ? Promise.reject(new Error('no such agent'))
        : agentCall(command, data)
    await expect(
      runSocialAgent(agent, social(questions()), d)
    ).resolves.toMatchObject({result: 'done', count: {alone: 5}})
  })
})
