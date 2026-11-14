import {dueToday, runJokeAgent} from './run'

const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const B12 = '0xb12aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa898'
const NOW = new Date(2026, 10, 14, 9, 30).getTime()
const YESTERDAY = NOW / 1000 - 86400

const t = (text, values = {}) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name]))
const agent = {
  id: 'aaaaaaaaaaaaaaaa',
  schedule: {kind: 'daily', time: '09:00'},
}
const jokeNode = (number, tips = [], time = YESTERDAY) => ({
  id: number,
  call: {
    author: ME,
    message: `📟 3615 IDENA\n\n🃏 Joke #${number}\n\nOld joke ${number}\n\nThanks to x for keeping the jokes alive!\nTip this post for a new joke tomorrow 😉`,
    replyTo: '',
    height: 100 + number,
    index: 0,
    time,
  },
  tips,
  likeCalls: [],
  replies: [],
})

function deps({
  decision = 'ask',
  pending = [],
  answer = 'A new joke.',
  post,
} = {}) {
  const calls = []
  return {
    calls,
    t,
    now: NOW,
    prepare: jest.fn().mockResolvedValue(0.01),
    post: post || jest.fn().mockResolvedValue('block 205'),
    agent: jest.fn(async (command, data) => {
      calls.push([command, data])
      if (command === 'pending') return pending
      if (command === 'writeText') return answer
      if (command === 'propose') return {decision, reason: 'r'}
      return null
    }),
  }
}

describe('a run of the joke agent', () => {
  test('no tip since the last joke: no joke, the model is not asked, the day is said skipped', async () => {
    const d = deps()
    const result = await runJokeAgent(
      agent,
      {feed: [jokeNode(3)], me: ME, names: {}},
      d
    )
    expect(result.result).toBe('skipped')
    expect(d.calls.map(([c]) => c)).toEqual(['pending', 'didAction'])
    expect(d.calls[1][1]).toMatchObject({
      skipped: true,
      detail: 'no tip since Joke #3: no joke today',
    })
  })

  test('Ask me: the post waits, numbered after the last joke, its thanks line built by the app', async () => {
    const d = deps()
    const feed = [jokeNode(3, [{from: B12, height: 110, index: 0}])]
    await expect(
      runJokeAgent(agent, {feed, me: ME, names: {[B12]: '@bob'}}, d)
    ).resolves.toEqual({result: 'ask', detail: 'r'})
    const [, input] = d.calls.find(([c]) => c === 'writeText')
    expect(input.input).toContain('Old joke 3')
    const [, proposal] = d.calls.find(([c]) => c === 'propose')
    expect(proposal).toMatchObject({
      action: 'post',
      editable: true,
      usage: 0,
      amount: 1,
      cost: 0.01,
    })
    expect(proposal.detail).toBe(
      '1 tipper since the last joke · fee about 0.01 iDNA'
    )
    expect(proposal.body).toBe(
      '📟 3615 IDENA\n\n🃏 Joke #4\n\nA new joke.\n\nThanks to @bob for keeping the jokes alive!\nTip this post for a new joke tomorrow 😉'
    )
    expect(d.post).not.toHaveBeenCalled()
  })

  test('Alone: posted, and said done with what it cost', async () => {
    const d = deps({decision: 'alone'})
    const feed = [jokeNode(3, [{from: B12, height: 110, index: 0}])]
    await expect(
      runJokeAgent(agent, {feed, me: ME, names: {}}, d)
    ).resolves.toEqual({result: 'posted', detail: 'block 205'})
    expect(d.post).toHaveBeenCalledWith(expect.stringContaining('Joke #4'))
    expect(d.calls.slice(-1)[0]).toEqual([
      'didAction',
      {
        agentId: agent.id,
        action: 'post',
        ok: true,
        cost: 0.01,
        detail: 'Joke #4 · block 205',
      },
    ])
  })

  test('a post that fails is said failed', async () => {
    const d = deps({
      decision: 'alone',
      post: jest.fn().mockRejectedValue(new Error('the contract refused it')),
    })
    const feed = [jokeNode(3, [{from: B12, height: 110, index: 0}])]
    await expect(
      runJokeAgent(agent, {feed, me: ME, names: {}}, d)
    ).resolves.toMatchObject({result: 'failed'})
    expect(d.calls.slice(-1)[0][1]).toMatchObject({
      ok: false,
      detail: 'the contract refused it',
    })
  })

  test('once a day: a joke posted today, or one waiting, stops the run before the model', async () => {
    const posted = deps()
    const today = [
      jokeNode(4, [], NOW / 1000 - 600),
      jokeNode(3, [{from: B12, height: 103, index: 1}]),
    ]
    await expect(
      runJokeAgent(agent, {feed: today, me: ME, names: {}}, posted)
    ).resolves.toMatchObject({result: 'done today'})
    const waiting = deps({pending: [{agentId: agent.id, action: 'post'}]})
    const feed = [jokeNode(3, [{from: B12, height: 110, index: 0}])]
    await expect(
      runJokeAgent(agent, {feed, me: ME, names: {}}, waiting)
    ).resolves.toMatchObject({result: 'waiting'})
    for (const d of [posted, waiting])
      expect(d.calls.map(([c]) => c)).not.toContain('writeText')
  })

  test('a model answer that is no joke is not posted', async () => {
    const d = deps({answer: '   ', decision: 'alone'})
    const feed = [jokeNode(3, [{from: B12, height: 110, index: 0}])]
    await expect(
      runJokeAgent(agent, {feed, me: ME, names: {}}, d)
    ).resolves.toMatchObject({result: 'failed'})
    expect(d.calls.map(([c]) => c)).not.toContain('propose')
  })

  test('its time of the day', () => {
    expect(dueToday({kind: 'daily', time: '09:00'}, NOW)).toBe(true)
    expect(dueToday({kind: 'daily', time: '10:00'}, NOW)).toBe(false)
    expect(dueToday({kind: 'manual', time: '09:00'}, NOW)).toBe(false)
  })
})
