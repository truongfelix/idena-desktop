/* global BigInt */
import os from 'os'
import path from 'path'
import fs from 'fs-extra'
import {socialDigest} from './digest'
import {doneOnFeed} from './plan'
import {runSocialAgent} from './run'
import {hoursOf} from '../read-again'

// Read again the last N hours (B-295): the read point goes back, never forward; what the agent already answered
// (its reply on the feed, its comment that answers, a reply waiting in To approve) is not read again.

const {createAgent} = require('../../../../main/agent/agent')
const {
  createAgentProfiles,
  validationAgentSettings,
} = require('../../../../main/agent/profiles')
const {createReadPoints} = require('../../../../main/agent/read-points')

const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const ANN = '0xa110000000000000000000000000000000000001'
const BOB = '0xb0b0000000000000000000000000000000000002'
const ID = 'dddddddddddddddd'
const HEAD = 10000
const NAMES = {[ME]: 'minitel'}

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))

const node = (id, author, message, height, replies = [], replyTo = '') => ({
  id,
  call: {author, message, replyTo, height, index: 0, time: height * 20},
  likeCalls: [],
  tips: [],
  replies,
})

const social = (feed) => ({
  feed,
  me: ME,
  head: HEAD,
  names: NAMES,
  blocked: new Set(),
  conversations: [],
})

describe('the point read again (B-295)', () => {
  test('back N hours of blocks before the head, never forward, within a day', () => {
    const {commands} = createReadPoints()
    commands.setReadPoint({agentId: ID, height: 9900})
    expect(commands.readAgain({agentId: ID, hours: 2, head: 10000})).toBe(9640)
    // A later point than the one it has: kept.
    expect(commands.readAgain({agentId: ID, hours: 1, head: 10000})).toBe(9640)
    // Never run yet: its first run reads a day already, nothing changes.
    expect(
      commands.readAgain({agentId: 'eeeeeeeeeeeeeeee', hours: 24, head: 3000})
    ).toBeNull()
    expect(() =>
      commands.readAgain({agentId: ID, hours: 25, head: 10000})
    ).toThrow('not a number of hours')
    expect(() =>
      commands.readAgain({agentId: ID, hours: 0, head: 10000})
    ).toThrow('not a number of hours')
    expect(() =>
      commands.readAgain({agentId: ID, hours: 1.5, head: 10000})
    ).toThrow('not a number of hours')
    expect(() => commands.readAgain({agentId: ID, hours: 2, head: -1})).toThrow(
      'not a block height'
    )
    // The point a run then saves moves forward again, as before.
    expect(commands.setReadPoint({agentId: ID, height: 10000})).toBe(10000)
  })

  test('the hours typed: a whole number from 1 to 24', () => {
    expect(hoursOf('2')).toBe(2)
    expect(hoursOf(' 24 ')).toBe(24)
    expect(hoursOf('0')).toBeNull()
    expect(hoursOf('25')).toBeNull()
    expect(hoursOf('1.5')).toBeNull()
    expect(hoursOf('')).toBeNull()
  })
})

describe('what it answered already is not read again (B-295)', () => {
  test('its reply under a post, or its comment answering a comment', () => {
    const asked = node(11, ANN, '@minitel what is Idena?', 9700)
    const commentTag = node(13, BOB, '@minitel and the fee?', 9720, [], '12')
    const myComment = node(14, ME, 'About 0.01 iDNA.', 9730, [], '13')
    const reply = node(12, ANN, 'A reply', 9710, [commentTag, myComment], '10')
    const feed = [
      node(10, BOB, 'A post', 9690, [reply]),
      node(20, ANN, '@minitel a new question', 9800),
      node(21, ANN, 'Answered', 9690, [
        asked,
        node(15, ME, 'It is…', 9750, [], '11'),
      ]),
    ]
    const {answered} = doneOnFeed(feed, ME)
    expect(answered.has('13')).toBe(true)
    expect(answered.has('11')).toBe(true)
    const digest = socialDigest(
      social(feed),
      {reads: {tags: {perDay: 5}}, answeredIds: answered},
      {point: 9000, scanned: HEAD}
    )
    expect(digest.text).toContain('@minitel a new question')
    expect(digest.text).not.toContain('what is Idena?')
    expect(digest.text).not.toContain('and the fee?')
    expect(digest.tagsShown).toBe(1)
    // Without it, as before: all three.
    expect(
      socialDigest(
        social(feed),
        {reads: {tags: {perDay: 5}}},
        {point: 9000, scanned: HEAD}
      ).tagsShown
    ).toBe(3)
  })

  test('a post it tipped is not read again; a conversation counts only after its own last message', () => {
    const tipped = node(40, ANN, 'Tipped already', 9700)
    tipped.tips = [{from: ME, height: 9710, postId: 40}]
    const feed = [tipped, node(41, ANN, 'Not tipped', 9705)]
    const {answered, tipped: ids} = doneOnFeed(feed, ME)
    ids.forEach((id) => answered.add(id))
    const chat = (messages) => ({
      key: `${ME}-${BOB}`,
      others: [BOB],
      isGroup: false,
      messages,
    })
    const digest = socialDigest(
      {
        ...social(feed),
        conversations: [
          chat([
            {from: BOB, text: 'Hello?', height: 9600, index: 0},
            {from: ME, text: 'Hello Bob', height: 9650, index: 0},
          ]),
        ],
      },
      {
        reads: {posts: {window: 'count', count: 50}, messages: true},
        answeredIds: answered,
      },
      {point: 9000, scanned: HEAD}
    )
    expect(digest.text).toContain('Not tipped')
    expect(digest.text).not.toContain('Tipped already')
    expect(digest.text).not.toContain('Hello?')
    // A message after its own: new.
    const again = socialDigest(
      {
        ...social([]),
        conversations: [
          chat([
            {from: BOB, text: 'Hello?', height: 9600, index: 0},
            {from: ME, text: 'Hello Bob', height: 9650, index: 0},
            {from: BOB, text: 'And now?', height: 9660, index: 0},
          ]),
        ],
      },
      {reads: {messages: true}},
      {point: 9000, scanned: HEAD}
    )
    expect(again.text).toContain('And now?')
  })

  describe('a run read again', () => {
    let dir
    let main
    let ask

    const start = () => {
      fs.writeJsonSync(path.join(dir, 'agents.json'), {
        v: 1,
        paused: false,
        agents: [
          {
            id: ID,
            name: 'Oracle',
            enabled: true,
            model: 'm',
            instructions: 'You answer questions.',
            budgetPerDay: 10,
            schedule: {kind: 'hourly'},
            actions: {
              readTags: {level: 'alone', limit: 5},
              reply: {level: 'ask', limit: 20},
            },
          },
        ],
      })
      const profiles = createAgentProfiles({
        file: () => path.join(dir, 'agents.json'),
      })
      ask = jest.fn(async () => '{"actions": []}')
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
        now: () => new Date(2026, 10, 18, 12).getTime(),
      })
      return profiles.read().agents[0]
    }

    const deps = () => ({
      t,
      agent: (command, data) => main.handle(command, data),
      prepare: jest.fn(async (item) => ({
        item,
        fee: {maxFee: BigInt(10) ** BigInt(16)},
        files: [],
        socialCall: {amount: '0'},
      })),
      send: jest.fn(async () => 'block 10001'),
    })

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-read-again-'))
    })
    afterEach(() => fs.removeSync(dir))

    test('a tag passed before is read; one answered, or whose reply waits in To approve, is not', async () => {
      const agent = start()
      const feed = [
        node(30, ANN, '@minitel passed over before', 9800),
        node(31, BOB, '@minitel answered', 9810, [
          node(32, ME, 'Here is the answer', 9820, [], '31'),
        ]),
        node(33, BOB, '@minitel its reply waits', 9830),
      ]
      await main.handle('setReadPoint', {agentId: ID, height: 9990})
      // A run at the point: nothing new.
      await expect(
        runSocialAgent(agent, social(feed), deps())
      ).resolves.toMatchObject({
        result: 'nothing new',
      })
      expect(ask).not.toHaveBeenCalled()
      // Its reply to 33 waits in To approve (an earlier run, Ask me).
      await main.handle('propose', {
        agentId: ID,
        action: 'reply',
        body: 'Waiting',
        detail: 'a reply',
        editable: true,
        target: {postId: 33, postTarget: null, author: BOB},
        amount: 1,
        cost: 0,
        skipOverLimit: true,
      })
      await main.handle('readAgain', {agentId: ID, hours: 2, head: HEAD})
      await runSocialAgent(agent, social(feed), deps())
      expect(ask).toHaveBeenCalledTimes(1)
      const input = ask.mock.calls[0][2][0].text
      expect(input).toContain('@minitel passed over before')
      expect(input).not.toContain('@minitel answered')
      expect(input).not.toContain('@minitel its reply waits')
      // Counted in its day as usual.
      await expect(main.handle('tagsToday', {agentId: ID})).resolves.toBe(1)
      await expect(main.handle('readPoint', {agentId: ID})).resolves.toBe(HEAD)
    })
  })
})
