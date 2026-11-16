import {FlipType} from '../../../shared/types'
import {contentsKey} from './drafts'
import {runFlipsAgent} from './run'

// A Flips run (B-258) against a fake flip store and a fake agent channel: the main process's checks are pending.js's,
// played here by `levels` (each step's level) and `limits` (each step's actions a day).

const ALL = [
  'flipStory',
  'flipPictures',
  'flipDraft',
  'flipJudge',
  'flipSubmit',
  'flipDelete',
]

function fakeStore(flips = []) {
  let list = flips.map((flip) => ({...flip}))
  return {
    getFlips: () => list.map((flip) => ({...flip})),
    getFlip: (id) => list.find((flip) => flip.id === id),
    addDraft: (flip) => {
      list = list.concat({...flip})
    },
    updateDraft: (flip) => {
      list = list.map((one) => (one.id === flip.id ? {...one, ...flip} : one))
    },
    deleteDraft: (id) => {
      list = list.map((one) =>
        one.id === id ? {...one, type: 'Removed', images: null} : one
      )
    },
  }
}

const identity = {
  state: 'Verified',
  availableFlips: 3,
  flips: [],
  flipKeyWordPairs: [{id: 4, words: [10, 11], used: false}],
}
const epoch = {currentPeriod: 'None'}

/** The agent holding `levels` ({step: level}), and the run's fakes. */
function setup({
  levels,
  limits = {},
  flips = [],
  answer,
  pending = [],
  // Each test its own agent: the failures of the day are kept by agent, in the module.
  agentId = 'a1',
}) {
  const agent = {
    id: agentId,
    actions: Object.fromEntries(
      Object.entries(levels).map(([id, level]) => [
        id,
        {level, limit: limits[id] ?? null},
      ])
    ),
  }
  const done = {}
  const lines = []
  const items = [...pending]
  let n = 0
  const decide = (action) => {
    const row = agent.actions[action]
    if (!row || row.level === 'off')
      return {decision: 'off', reason: 'action off'}
    if (row.level === 'ask') return {decision: 'ask', reason: 'asks first'}
    if (row.limit !== null && (done[action] || 0) + 1 > row.limit)
      return {decision: 'ask', reason: 'above the limit'}
    return {decision: 'alone', reason: 'within the limit'}
  }
  const call = jest.fn(async (command, data) => {
    switch (command) {
      case 'pending':
        return items
      case 'mayDo':
        return decide(data.action)
      case 'propose': {
        const check = decide(data.action)
        if (check.decision === 'alone') {
          done[data.action] = (done[data.action] || 0) + 1
          return check
        }
        if (check.reason === 'above the limit')
          return {decision: 'skipped', reason: check.reason}
        n += 1
        const item = {id: `item${n}`, action: data.action, target: data.target}
        items.push(item)
        return {...check, item}
      }
      case 'didAction':
        lines.push([data.action, data.ok, data.skipped, data.detail])
        return null
      default:
        throw new Error(`unexpected ${command}`)
    }
  })
  const ipc = jest.fn(async (command, data) => {
    if (command === 'writeStory')
      return {
        stories: [
          {
            title: 'Cat climbs',
            story: 'A cat...',
            prompts: ['p1', 'p2', 'p3', 'p4'],
          },
        ],
      }
    if (command === 'judgeFlip') return answer(data.flip)
    throw new Error(`unexpected ${command}`)
  })
  const store = fakeStore(flips)
  const settled = []
  const deps = {
    call,
    ipc,
    store,
    loadWords: async (pair) =>
      pair.words.map((id) => ({id, name: `w${id}`, desc: ''})),
    draw: jest.fn(async (_, prompt) => `data:image/png;base64,${prompt}`),
    protect: jest.fn(async (flip) => ({
      protectedImages: flip.originalOrder.map(
        (slot) => `data:image/jpeg;base64,P${slot}`
      ),
      adversarialImage: 'nonsense',
      noise: [null, null, null, null],
    })),
    submit: jest.fn(async (id) => {
      store.updateDraft({
        id,
        type: FlipType.Publishing,
        agentFlip: {...store.getFlip(id).agentFlip, stage: 'submitted'},
      })
      return '0xhash'
    }),
    settle: (id, step) => settled.push([id, step]),
    verdictText: (verdict) => (verdict && verdict.pass ? 'passes' : 'fails'),
    newId: () => 'new',
    now: () => Date.UTC(2026, 10, 16),
    random: () => 0.3,
    t: (text, values) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key])),
  }
  return {agent, deps, store, lines, items, settled}
}

/** The judge's answer: the story's side (found by its order), keywords shown, nothing reported. */
const rightAnswer = (story) => (flip) => ({
  answer: flip.orders[0].join() === story.join() ? 'left' : 'right',
  relevance: 'relevant',
  report: false,
  reasons: [],
})

describe('a Flips run', () => {
  test('one agent holding every step Alone takes a flip from its story to the chain in one run', async () => {
    const levels = Object.fromEntries(ALL.map((id) => [id, 'alone']))
    const {agent, deps, store} = setup({levels, answer: () => null})
    // The judge answers with the story's side of the draft it is sent.
    deps.ipc.mockImplementation(async (command, data) => {
      if (command === 'writeStory')
        return {
          stories: [{title: 'T', story: 'S', prompts: ['p1', 'p2', 'p3']}],
        }
      return rightAnswer(store.getFlip('new').originalOrder)(data.flip)
    })
    const outcome = await runFlipsAgent(agent, {identity, epoch}, deps)
    const flip = store.getFlip('new')
    expect(flip.type).toBe(FlipType.Publishing)
    expect(flip.agentFlip.stage).toBe('submitted')
    expect(flip.keywordPairId).toBe(4)
    expect(flip.story.words).toEqual(['w10', 'w11'])
    // Three pictures in the free slots, the nonsense picture's slot left for Protect.
    expect(flip.images.filter(Boolean)).toHaveLength(3)
    expect(flip.images[flip.adversarialImageId]).toBeNull()
    expect(flip.agentVerdict).toMatchObject({pass: true, by: 'a1'})
    expect(flip.agentVerdict.contents).toBe(contentsKey(flip))
    expect(deps.submit).toHaveBeenCalledWith('new')
    expect(outcome).toMatchObject({
      result: 'done',
      count: {alone: 5, ask: 0, skipped: 0, failed: 0},
    })
  })

  test('with Ask me, the story waits in To approve and the next steps wait for it', async () => {
    const {agent, deps, store, items} = setup({
      levels: {flipStory: 'ask', flipPictures: 'alone', flipDraft: 'alone'},
    })
    await runFlipsAgent(agent, {identity, epoch}, deps)
    const flip = store.getFlip('new')
    expect(flip.agentFlip.waiting).toEqual({step: 'flipStory', id: 'item1'})
    expect(items).toEqual([
      {id: 'item1', action: 'flipStory', target: {flipId: 'new'}},
    ])
    expect(deps.draw).not.toHaveBeenCalled()
    // Approved (the wait cleared), the next run draws its pictures and drafts it.
    store.updateDraft({
      id: 'new',
      agentFlip: {...flip.agentFlip, waiting: null},
    })
    await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(deps.draw).toHaveBeenCalledTimes(3)
    expect(store.getFlip('new').agentFlip.stage).toBe('drafted')
  })

  test('past its limit a day, a step asks the model nothing', async () => {
    const {agent, deps, lines} = setup({
      levels: {flipStory: 'alone'},
      limits: {flipStory: 0},
    })
    const outcome = await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(deps.ipc).not.toHaveBeenCalled()
    expect(lines).toEqual([['flipStory', undefined, true, 'above the limit']])
    expect(outcome.count).toMatchObject({skipped: 1})
  })

  test('no new draft during a validation, nor for an identity that cannot make flips', async () => {
    const {agent, deps} = setup({levels: {flipStory: 'alone'}})
    expect(
      await runFlipsAgent(
        agent,
        {identity, epoch: {currentPeriod: 'ShortSession'}},
        deps
      )
    ).toMatchObject({result: 'nothing new'})
    await runFlipsAgent(
      agent,
      {identity: {...identity, state: 'Candidate'}, epoch},
      deps
    )
    expect(deps.ipc).not.toHaveBeenCalled()
  })

  test("the judge judges the person's draft but nothing else touches it; a failed agent draft is deleted", async () => {
    const shuffled = {
      type: FlipType.Draft,
      createdAt: '2026-11-16T09:00:00.000Z',
      keywordPairId: 7,
      keywords: {words: [{name: 'cat'}, {name: 'tree'}]},
      originalOrder: [0, 3, 1, 2],
      order: [2, 1, 3, 0],
      adversarialImageId: 3,
      protectedImages: ['data:a,AA', 'data:a,BB', 'data:a,CC', 'data:a,DD'],
    }
    const person = {...shuffled, id: 'person'}
    const agents = {
      ...shuffled,
      id: 'agents',
      keywordPairId: 8,
      agentFlip: {by: 'a2', stage: 'drafted', waiting: null, declined: {}},
    }
    const {agent, deps, store} = setup({
      levels: {flipJudge: 'alone', flipSubmit: 'alone', flipDelete: 'alone'},
      flips: [person, agents],
      // Wrong side every time: both fail.
      answer: (flip) => ({
        answer: flip.orders[0].join() === '0,3,1,2' ? 'right' : 'left',
        relevance: 'relevant',
        report: false,
      }),
    })
    await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(store.getFlip('person').agentVerdict).toMatchObject({pass: false})
    expect(store.getFlip('person').type).toBe(FlipType.Draft)
    expect(store.getFlip('agents').type).toBe('Removed')
    expect(deps.submit).not.toHaveBeenCalled()
    // Judged as it is: the next run asks nothing more.
    deps.ipc.mockClear()
    await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(deps.ipc).not.toHaveBeenCalled()
  })

  test('a draft waiting on an item gone from To approve is settled first', async () => {
    const waiting = {
      id: 'w',
      type: FlipType.Draft,
      agentFlip: {
        by: 'a1',
        stage: 'story',
        waiting: {step: 'flipStory', id: 'gone'},
      },
    }
    const {agent, deps, settled} = setup({
      levels: {flipPictures: 'alone'},
      flips: [waiting],
    })
    await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(settled).toEqual([['w', 'flipStory']])
  })

  test('a failed answer of the model is not written twice in Activity, nor asked again that day', async () => {
    const {agent, deps, lines} = setup({
      levels: {flipStory: 'alone'},
      agentId: 'failing',
    })
    deps.ipc.mockImplementation(async () => {
      const error = new Error('the service did not answer')
      error.logged = true
      throw error
    })
    const outcome = await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(lines).toEqual([])
    expect(outcome.count).toMatchObject({failed: 1})
    // The same pair is not asked again today.
    deps.ipc.mockClear()
    await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(deps.ipc).not.toHaveBeenCalled()
  })

  const ready = (fields = {}) => ({
    id: 'agents',
    type: FlipType.Draft,
    createdAt: '2026-11-16T09:00:00.000Z',
    keywordPairId: 8,
    keywords: {words: [{name: 'cat'}, {name: 'tree'}]},
    originalOrder: [0, 3, 1, 2],
    order: [2, 1, 3, 0],
    adversarialImageId: 3,
    protectedImages: ['data:a,AA', 'data:a,BB', 'data:a,CC', 'data:a,DD'],
    agentFlip: {by: 'a2', stage: 'drafted', waiting: null, declined: {}},
    ...fields,
  })

  test('an answer of the judge it cannot read is no verdict: the draft is not deleted', async () => {
    const {agent, deps, store} = setup({
      levels: {flipJudge: 'alone', flipDelete: 'alone'},
      flips: [ready()],
      answer: () => ({answer: null, relevance: null, report: false}),
      agentId: 'unreadable',
    })
    const outcome = await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(store.getFlip('agents').agentVerdict).toBeUndefined()
    expect(store.getFlip('agents').type).toBe(FlipType.Draft)
    expect(outcome.count).toMatchObject({failed: 1})
  })

  test('a draft changed while the step worked is not written over', async () => {
    const story = {
      id: 'drawn',
      type: FlipType.Draft,
      createdAt: '2026-11-16T09:00:00.000Z',
      keywordPairId: 9,
      originalOrder: [0, 3, 1, 2],
      adversarialImageId: 3,
      images: [null, null, null, null],
      story: {stories: [{title: 'T', prompts: ['p1', 'p2', 'p3']}]},
      agentFlip: {by: 'a1', stage: 'story', waiting: null, declined: {}},
    }
    const {agent, deps, store, lines} = setup({
      levels: {flipPictures: 'alone'},
      flips: [story],
      agentId: 'overwrite',
    })
    // The person puts a picture of their own in while the agent draws.
    deps.draw.mockImplementation(async (_, prompt) => {
      if (prompt === 'p3')
        store.updateDraft({id: 'drawn', images: ['mine', null, null, null]})
      return `data:image/png;base64,${prompt}`
    })
    await runFlipsAgent(agent, {identity, epoch}, deps)
    expect(store.getFlip('drawn').images).toEqual(['mine', null, null, null])
    expect(store.getFlip('drawn').agentFlip.stage).toBe('story')
    expect(lines).toEqual([
      [
        'flipPictures',
        undefined,
        true,
        'the draft changed meanwhile: not written over',
      ],
    ])
  })
})
