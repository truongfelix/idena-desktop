import os from 'os'
import path from 'path'
import fs from 'fs-extra'
import {MAX_PICTURES, isPicture, socialDigest} from './digest'
import {runSocialAgent} from './run'
import {fittedSize, loadPicture, loadPictures, mediaBytes} from './pictures'

// The pictures of the posts a Social run reads (B-293): named in the text, loaded, sent after the text, each after
// its name; within MAX_PICTURES a run; the others keep the placeholder.

const {createAgent, socialParts} = require('../../../../main/agent/agent')
const {
  createAgentProfiles,
  validationAgentSettings,
} = require('../../../../main/agent/profiles')
const {
  exportAgent,
  readAgentFile,
} = require('../../../../main/agent/agent-file')

const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const ANN = '0xa110000000000000000000000000000000000001'
const BOB = '0xb0b0000000000000000000000000000000000002'
const ID = 'dddddddddddddddd'
const HEAD = 10000
const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))

const picture = (media, mediaType = 'image/webp') => ({
  hasMedia: true,
  media,
  mediaType,
})

const node = (id, author, message, height, more = {}, replies = []) => ({
  id,
  call: {
    author,
    message,
    replyTo: '',
    height,
    index: 0,
    time: height * 20,
    ...more,
  },
  likeCalls: [],
  tips: [],
  replies,
})

const POSTS = {posts: {window: 'count', count: 50}}

const state = (feed) => ({
  feed,
  me: ME,
  head: HEAD,
  names: {[ME]: 'minitel', [BOB]: '@bob'},
  blocked: new Set(),
  conversations: [],
})

describe('the pictures a run names (B-293)', () => {
  test('a picture inline or on IPFS; a video, an SVG or nothing is none', () => {
    expect(isPicture(picture('AAAA'))).toBe(true)
    expect(isPicture(picture(`ipfs://${CID}`, 'image/png'))).toBe(true)
    expect(isPicture(picture('AAAA', 'video/mp4'))).toBe(false)
    expect(isPicture(picture('AAAA', 'image/svg+xml'))).toBe(false)
    // Too large to be kept inline (calls.js): no media to read.
    expect(isPicture(picture(''))).toBe(false)
    expect(isPicture({message: 'hi'})).toBe(false)
  })

  test('collected, then named only when loaded; the others keep the placeholder; one picture shown twice, one name', () => {
    const feed = [
      node(31, BOB, 'A cat', 9990, picture(`ipfs://${CID}`)),
      node(30, ANN, 'A dog', 9980, picture('AAAA', 'image/png')),
      node(29, ANN, 'A film', 9970, picture('BBBB', 'video/mp4')),
      node(28, BOB, 'The same cat', 9960, picture(`ipfs://${CID}`)),
    ]
    const wanted = new Map()
    socialDigest(
      state(feed),
      {reads: POSTS, pictures: {collect: wanted}},
      {point: 9000, scanned: HEAD}
    )
    expect([...wanted.entries()]).toEqual([
      [`ipfs://${CID}`, 'image/webp'],
      ['AAAA', 'image/png'],
    ])
    // The IPFS one could not be read: only the inline one is named.
    const digest = socialDigest(
      state(feed),
      {reads: POSTS, pictures: {have: new Set(['AAAA'])}},
      {point: 9000, scanned: HEAD}
    )
    expect(digest.pictures).toEqual([{id: 'img1', media: 'AAAA'}])
    expect(digest.text).toContain('"A dog [with the picture img1]"')
    expect(digest.text).toContain('"A cat [with a picture or a file]"')
    expect(digest.text).toContain('"A film [with a picture or a file]"')
    // Both loaded: the cat shown twice is img1 twice.
    const both = socialDigest(
      state(feed),
      {
        reads: POSTS,
        pictures: {have: new Set([`ipfs://${CID}`, 'AAAA'])},
      },
      {point: 9000, scanned: HEAD}
    )
    expect(both.pictures.map(({id}) => id)).toEqual(['img1', 'img2'])
    expect(both.text).toContain('"The same cat [with the picture img1]"')
    expect(both.text).toContain('"A cat [with the picture img1]"')
    // Without pictures asked (a model that reads text only): no name, as before.
    const none = socialDigest(
      state(feed),
      {reads: POSTS},
      {point: 9000, scanned: HEAD}
    )
    expect(none.pictures).toEqual([])
    expect(none.text).not.toContain('img1')
  })

  test('at most MAX_PICTURES a run: the next ones are only named as before', () => {
    const feed = Array.from({length: MAX_PICTURES + 3}, (_, i) =>
      node(100 + i, ANN, `Picture ${i}`, 9100 + i, picture(`P${i}`))
    )
    const wanted = new Map()
    socialDigest(
      state(feed),
      {reads: POSTS, pictures: {collect: wanted}},
      {point: 9000, scanned: HEAD}
    )
    expect(wanted.size).toBe(MAX_PICTURES)
    const digest = socialDigest(
      state(feed),
      {reads: POSTS, pictures: {have: new Set(wanted.keys())}},
      {point: 9000, scanned: HEAD}
    )
    expect(digest.pictures).toHaveLength(MAX_PICTURES)
    expect(digest.text.match(/\[with the picture img\d+\]/gu)).toHaveLength(
      MAX_PICTURES
    )
    expect(digest.text.match(/\[with a picture or a file\]/gu)).toHaveLength(3)
  })

  test("a tag's whole thread: the first post's picture, a reply's, the tag's own", () => {
    const tag = node(43, ANN, '@minitel what is on these?', 9990, picture('T'))
    const reply = node(42, BOB, 'Look at mine', 9980, picture('R'), [tag])
    const post = node(41, BOB, 'My garden', 9970, picture('F'), [reply])
    const wanted = new Map()
    const reads = {tags: {perDay: 5}}
    socialDigest(
      state([post]),
      {reads, pictures: {collect: wanted}},
      {point: 9000, scanned: HEAD}
    )
    expect([...wanted.keys()].sort()).toEqual(['F', 'R', 'T'])
    const digest = socialDigest(
      state([post]),
      {reads, pictures: {have: new Set(wanted.keys())}},
      {point: 9000, scanned: HEAD}
    )
    expect(digest.pictures).toHaveLength(3)
    expect(digest.text).toContain('[with the picture img1]')
    expect(digest.text).toContain('[with the picture img2]')
    expect(digest.text).toContain('[with the picture img3]')
  })

  test('a tag answering its own picture post: its own picture is not sent', () => {
    const tag = node(61, ANN, '@minitel what is this?', 9990, picture('T'))
    const own = node(60, ME, 'My picture', 9980, picture('MINE'), [tag])
    const wanted = new Map()
    socialDigest(
      state([own]),
      {reads: {tags: {perDay: 5}}, pictures: {collect: wanted}},
      {point: 9000, scanned: HEAD}
    )
    expect([...wanted.keys()]).toEqual(['T'])
  })

  test('its own posts keep the placeholder: only what others posted is shown', () => {
    const feed = [node(50, ME, 'My own picture', 9990, picture('MINE'))]
    const wanted = new Map()
    socialDigest(
      state(feed),
      {reads: {own: true}, pictures: {collect: wanted}},
      {point: 9000, scanned: HEAD}
    )
    expect(wanted.size).toBe(0)
  })
})

describe('the pictures loaded (B-293)', () => {
  test('inline base64, or read through the node; one that cannot be read is null', async () => {
    const rpc = jest.fn(async () => '0x0102ff')
    expect([...(await mediaBytes(`ipfs://${CID}`, rpc))]).toEqual([1, 2, 255])
    expect(rpc).toHaveBeenCalledWith('ipfs_get', [CID], expect.any(Number))
    expect([...(await mediaBytes('AQL/', rpc))]).toEqual([1, 2, 255])
    expect(await mediaBytes('ipfs://not-a-cid', rpc)).toBeNull()
    const draw = jest.fn(async () => ({mediaType: 'image/jpeg', data: 'QQ=='}))
    expect(await loadPicture('AQL/', 'image/png', {rpc, draw})).toEqual({
      mediaType: 'image/jpeg',
      data: 'QQ==',
    })
    // No node has it: the node's IPFS error.
    const missing = jest.fn(async () => {
      throw new Error('timeout while reading data from ipfs')
    })
    expect(
      await loadPicture(`ipfs://${CID}`, 'image/png', {rpc: missing, draw})
    ).toBeNull()
    // A picture the window cannot decode.
    const broken = jest.fn(async () => {
      throw new Error('The source image could not be decoded.')
    })
    expect(await loadPicture('AQL/', 'image/png', {rpc, draw: broken})).toBe(
      null
    )
  })

  test('scaled to at most 1024 on the longer side, never enlarged', () => {
    expect(fittedSize(4000, 3000)).toEqual([1024, 768])
    expect(fittedSize(600, 2400)).toEqual([256, 1024])
    expect(fittedSize(320, 200)).toEqual([320, 200])
  })

  test('a few at once, those read kept', async () => {
    let running = 0
    let most = 0
    const wanted = new Map(
      Array.from({length: 9}, (_, i) => [`P${i}`, 'image/png'])
    )
    const loaded = await loadPictures(wanted, async (media) => {
      running += 1
      most = Math.max(most, running)
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
      running -= 1
      return media === 'P3' ? null : {mediaType: 'image/jpeg', data: media}
    })
    expect(most).toBeLessThanOrEqual(4)
    expect([...loaded.keys()]).toHaveLength(8)
    expect(loaded.has('P3')).toBe(false)
  })
})

describe('the question of a run with pictures (B-293)', () => {
  test('the text, then each picture after its name; a picture not one the models read is left out', () => {
    const agent = {postPictures: 'send'}
    const jpeg = {mediaType: 'image/jpeg', data: 'QUJD'}
    expect(
      socialParts(agent, 'the posts', [
        {id: 'img1', ...jpeg},
        {id: 'img2', mediaType: 'image/svg+xml', data: 'QUJD'},
        {id: 'img3', mediaType: 'image/png', data: 'not base64!'},
        {id: 'img1', ...jpeg},
        {id: 'p1', ...jpeg},
        {id: 'img4', mediaType: 'image/webp', data: 'QUJD'},
      ])
    ).toEqual([
      {type: 'text', text: 'the posts'},
      {type: 'text', text: 'img1:'},
      {type: 'image', ...jpeg},
      {type: 'text', text: 'img4:'},
      {type: 'image', mediaType: 'image/webp', data: 'QUJD'},
    ])
    // At most 20 MB of pictures a run (the API refuses a larger request): those past it are left out.
    const big = 'A'.repeat(4 * 1024 * 1024)
    const many = Array.from({length: 6}, (_, i) => ({
      id: `img${i + 1}`,
      mediaType: 'image/jpeg',
      data: big,
    }))
    expect(
      socialParts(agent, 'the posts', many).filter(({type}) => type === 'image')
    ).toHaveLength(5)
    // Only named: no picture, whatever the window sent.
    expect(
      socialParts({postPictures: 'say'}, 'the posts', [{id: 'img1', ...jpeg}])
    ).toEqual([{type: 'text', text: 'the posts'}])
  })

  describe('a run', () => {
    let dir
    let ask

    const start = (more) => {
      fs.writeJsonSync(path.join(dir, 'agents.json'), {
        v: 1,
        paused: false,
        agents: [
          {
            id: ID,
            name: 'Oracle',
            enabled: true,
            model: 'm',
            instructions: 'Answer kindly.',
            budgetPerDay: 10,
            schedule: {kind: 'hourly'},
            actions: {
              readPosts: {level: 'alone', window: 'count', count: 50},
              reply: {level: 'ask'},
            },
            ...more,
          },
        ],
      })
      const profiles = createAgentProfiles({
        file: () => path.join(dir, 'agents.json'),
      })
      ask = jest.fn(async () => '{"actions": []}')
      const main = createAgent({
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
      return {main, agent: profiles.read().agents[0]}
    }

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pictures-'))
    })
    afterEach(() => fs.removeSync(dir))

    const feed = () => [
      node(31, BOB, 'What is this?', 9990, picture(`ipfs://${CID}`)),
      node(30, ANN, 'Gone', 9980, picture('GONE', 'image/png')),
    ]

    test('shown: the pictures read go to the model after its text; one that could not be read stays a placeholder', async () => {
      const {main, agent} = start({postPictures: 'send'})
      expect(agent.postPictures).toBe('send')
      const load = jest.fn(async (media) =>
        media === 'GONE' ? null : {mediaType: 'image/jpeg', data: 'Q0FU'}
      )
      const outcome = await runSocialAgent(agent, state(feed()), {
        t,
        agent: (command, data) => main.handle(command, data),
        prepare: jest.fn(),
        send: jest.fn(),
        loadPicture: load,
      })
      expect(outcome.result).toBe('done')
      expect(load).toHaveBeenCalledTimes(2)
      const parts = ask.mock.calls[0][2]
      expect(parts).toHaveLength(3)
      expect(parts[0].text).toContain('"What is this? [with the picture img1]"')
      expect(parts[0].text).toContain('"Gone [with a picture or a file]"')
      expect(parts.slice(1)).toEqual([
        {type: 'text', text: 'img1:'},
        {type: 'image', mediaType: 'image/jpeg', data: 'Q0FU'},
      ])
    })

    test('only named: nothing loaded, nothing but the text sent', async () => {
      const {main, agent} = start({postPictures: 'say'})
      const load = jest.fn()
      await runSocialAgent(agent, state(feed()), {
        t,
        agent: (command, data) => main.handle(command, data),
        prepare: jest.fn(),
        send: jest.fn(),
        loadPicture: load,
      })
      expect(load).not.toHaveBeenCalled()
      const parts = ask.mock.calls[0][2]
      expect(parts).toHaveLength(1)
      expect(parts[0].text).toContain(
        '"What is this? [with a picture or a file]"'
      )
    })
  })
})

describe('the setting (B-293)', () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pictures-set-'))
  })
  afterEach(() => fs.removeSync(dir))

  const saved = (agents) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {v: 1, agents})
    return createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    }).read().agents
  }

  test('an agent saved before: shown to an Anthropic model, only named for another; a choice kept', () => {
    const [claude, local, chosen] = saved([
      {id: 'aaaaaaaaaaaaaaaa', name: 'A', provider: 'anthropic', model: 'm'},
      {id: 'bbbbbbbbbbbbbbbb', name: 'B', provider: 'local', model: 'm'},
      {
        id: 'cccccccccccccccc',
        name: 'C',
        provider: 'local',
        model: 'm',
        postPictures: 'send',
      },
    ])
    expect(claude.postPictures).toBe('send')
    expect(local.postPictures).toBe('say')
    expect(chosen.postPictures).toBe('send')
  })

  test('its file carries it, and the import reads it back', () => {
    const [agent] = saved([
      {
        id: 'aaaaaaaaaaaaaaaa',
        name: 'A',
        provider: 'anthropic',
        model: 'm',
        postPictures: 'say',
      },
    ])
    const text = exportAgent(agent)
    expect(JSON.parse(text).postPictures).toBe('say')
    expect(readAgentFile(text, []).agent.postPictures).toBe('say')
  })

  test('imported for another service than Anthropic: only named, whatever the file says', () => {
    const [agent] = saved([
      {
        id: 'aaaaaaaaaaaaaaaa',
        name: 'A',
        provider: 'local',
        model: 'm',
        postPictures: 'send',
      },
    ])
    expect(agent.postPictures).toBe('send')
    expect(readAgentFile(exportAgent(agent), []).agent.postPictures).toBe('say')
  })
})
