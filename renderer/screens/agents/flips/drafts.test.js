import {FlipType} from '../../../shared/types'
import {areEqual, areEqualExceptOne} from '../../../shared/utils/arr'
import {
  contentsKey,
  declinedChange,
  draftStatus,
  draftsAt,
  freePairs,
  heldFlipSteps,
  judgeQuestion,
  judgedPass,
  orphans,
  rewritesAllowed,
  shuffledOrder,
  storyForPictures,
  verdictOf,
} from './drafts'

const pics = ['data:image/jpeg;base64,AA', 'data:image/jpeg;base64,BB']
const protectedImages = [pics[0], pics[1], pics[0], pics[1]]

/** An agent draft at `stage`, protected and shuffled from 'drafted'. */
function draft(stage, fields = {}) {
  return {
    id: `f-${stage}`,
    type: FlipType.Draft,
    createdAt: '2026-11-16T10:00:00.000Z',
    keywordPairId: 1,
    keywords: {words: [{name: 'cat'}, {name: 'tree'}]},
    originalOrder: [0, 3, 1, 2],
    order: stage === 'drafted' ? [2, 1, 3, 0] : [0, 3, 1, 2],
    adversarialImageId: 3,
    protectedImages:
      stage === 'drafted' ? protectedImages : [null, null, null, null],
    agentFlip: {by: 'a1', stage, waiting: null, declined: {}},
    ...fields,
  }
}

const passed = (flip, fields = {}) => ({
  ...flip,
  agentVerdict: {
    contents: contentsKey(flip),
    pass: true,
    waiting: null,
    declined: false,
    ...fields,
  },
})

describe('the drafts waiting at each step', () => {
  test('each step takes the agent drafts at its stage, none waiting in To approve', () => {
    const story = draft('story')
    const pictures = draft('pictures')
    const waiting = draft('story', {
      id: 'w',
      agentFlip: {
        by: 'a1',
        stage: 'story',
        waiting: {step: 'flipStory', id: 'i'},
      },
    })
    const flips = [story, pictures, waiting]
    expect(draftsAt('flipPictures', flips).map(({id}) => id)).toEqual([
      'f-story',
    ])
    expect(draftsAt('flipDraft', flips).map(({id}) => id)).toEqual([
      'f-pictures',
    ])
  })

  test("the judge takes every shuffled draft without a verdict on it as it is, the person's too", () => {
    const mine = draft('drafted', {id: 'person', agentFlip: undefined})
    const unshuffled = draft('drafted', {
      id: 'unshuffled',
      agentFlip: undefined,
      order: [0, 3, 1, 2],
    })
    const judged = passed(draft('drafted', {id: 'judged'}))
    const changed = {...judged, id: 'changed', order: [1, 2, 3, 0]}
    const sent = draft('drafted', {id: 'sent', type: FlipType.Published})
    expect(
      draftsAt('flipJudge', [mine, unshuffled, judged, changed, sent]).map(
        ({id}) => id
      )
      // A sent flip only when an agent may delete one (B-277, below).
    ).toEqual(['person', 'changed'])
  })

  test('Submit takes only an agent draft the judge passed as it is now', () => {
    const ok = passed(draft('drafted', {id: 'ok'}))
    const person = passed(
      draft('drafted', {id: 'person', agentFlip: undefined})
    )
    const askMe = passed(draft('drafted', {id: 'ask'}), {waiting: 'item'})
    const declined = passed(draft('drafted', {id: 'declined'}), {
      declined: true,
    })
    const failed = passed(draft('drafted', {id: 'failed'}), {pass: false})
    const moved = {
      ...passed(draft('drafted', {id: 'moved'})),
      order: [1, 2, 3, 0],
    }
    const refused = passed(draft('drafted', {id: 'refused'}))
    refused.agentFlip = {
      ...refused.agentFlip,
      declined: {flipSubmit: contentsKey(refused)},
    }
    const flips = [ok, person, askMe, declined, failed, moved, refused]
    expect(draftsAt('flipSubmit', flips).map(({id}) => id)).toEqual(['ok'])
    expect(draftsAt('flipDelete', flips).map(({id}) => id)).toEqual(['failed'])
    expect(judgedPass(ok)).toBe(true)
    expect(judgedPass(moved)).toBe(false)
  })
})

describe('the keyword pairs for new drafts', () => {
  const identity = {
    state: 'Verified',
    availableFlips: 3,
    flips: ['0xsent'],
    flipKeyWordPairs: [
      {id: 0, words: [1, 2], used: true},
      {id: 1, words: [3, 4], used: false},
      {id: 2, words: [5, 6], used: false},
      {id: 3, words: [7, 8], used: false},
    ],
  }
  test('pairs not used and held by no flip, as many as flips are left to make', () => {
    // 3 to make, 1 sent: room for 2.
    expect(freePairs(identity, []).map(({id}) => id)).toEqual([1, 2])
    // The person's draft holds pair 1 and may be sent: room for 1.
    const person = {type: FlipType.Draft, keywordPairId: 1}
    expect(freePairs(identity, [person]).map(({id}) => id)).toEqual([2])
    // A flip being sent, not counted as made yet, takes a place too; once made (its hash in the identity's flips)
    // it is counted once.
    const sending = {type: FlipType.Publishing, keywordPairId: 2, hash: '0xnew'}
    expect(freePairs(identity, [sending]).map(({id}) => id)).toEqual([1])
    expect(
      freePairs({...identity, flips: ['0xsent', '0xnew']}, [sending]).map(
        ({id}) => id
      )
    ).toEqual([1])
    expect(freePairs(identity, [person, sending])).toEqual([])
    // An archived flip of an earlier epoch holds nothing.
    const archived = {type: FlipType.Archived, keywordPairId: 2}
    expect(freePairs(identity, [archived]).map(({id}) => id)).toEqual([1, 2])
    expect(freePairs({...identity, availableFlips: 1}, [])).toEqual([])
    expect(freePairs(null, [])).toEqual([])
  })
})

describe('the flip as the judge sees it', () => {
  test("a shuffled order is never the story's, nor the story's with the nonsense picture moved", () => {
    // A random source that gives the story's order first (no swap), then the story's with the nonsense picture
    // moved (the first two swapped), then a real shuffle, over and over.
    const values = [0.99, 0.99, 0.99, 0.99, 0.99, 0.0, 0.1, 0.5, 0.7]
    const original = [0, 3, 1, 2]
    let n = -1
    const random = () => {
      n += 1
      return values[n % values.length]
    }
    for (let i = 0; i < 20; i += 1) {
      const order = shuffledOrder(original, 3, random)
      expect(order.slice().sort()).toEqual([0, 1, 2, 3])
      expect(areEqual(order, original)).toBe(false)
      expect(areEqualExceptOne(original, order, 3)).toBe(false)
    }
    // A source that never shuffles still gives an order publishFlip takes.
    const stuck = shuffledOrder(original, 3, () => 0.99)
    expect(areEqual(stuck, original)).toBe(false)
    expect(areEqualExceptOne(original, stuck, 3)).toBe(false)
  })

  test("the story's order on a side at random; the verdict passes only on the story found, the keywords shown, nothing reported", () => {
    const flip = draft('drafted')
    const left = judgeQuestion(flip, () => 0.1)
    expect(left.storySide).toBe('left')
    expect(left.flip.orders).toEqual([flip.originalOrder, flip.order])
    expect(left.flip.images).toEqual(['AA', 'BB', 'AA', 'BB'])
    expect(left.flip.words).toEqual([
      {name: 'cat', desc: ''},
      {name: 'tree', desc: ''},
    ])
    const right = judgeQuestion(flip, () => 0.9)
    expect(right.storySide).toBe('right')
    expect(right.flip.orders).toEqual([flip.order, flip.originalOrder])

    const at = {storySide: 'left', flip, by: 'a1', at: 1}
    const good = {answer: 'left', relevance: 'relevant', report: false}
    expect(verdictOf(good, at).pass).toBe(true)
    expect(verdictOf(good, at).contents).toBe(contentsKey(flip))
    expect(verdictOf({...good, answer: 'right'}, at).pass).toBe(false)
    expect(verdictOf({...good, relevance: null}, at).pass).toBe(false)
    expect(
      verdictOf(
        {
          ...good,
          relevance: 'irrelevant',
          report: true,
          reasons: [{reason: 2, confidence: 0.8}],
        },
        at
      )
    ).toMatchObject({pass: false, reported: true, reasons: [{reason: 2}]})
    expect(verdictOf(null, at).pass).toBe(false)
  })

  test('the story for the pictures: the first with three prompts or more, four of them at most (B-283)', () => {
    const story = {
      stories: [
        {title: 'short', prompts: ['a', 'b']},
        {title: 'long', prompts: ['1', '2', '3', '4', '5']},
      ],
    }
    expect(storyForPictures(story)).toEqual({
      title: 'long',
      prompts: ['1', '2', '3', '4'],
    })
    expect(
      storyForPictures({stories: [{title: 'three', prompts: ['1', '2', '3']}]})
    ).toEqual({title: 'three', prompts: ['1', '2', '3']})
    // A draft's story: as many prompts as the draft has slots for; too few, none.
    expect(storyForPictures(story, 3).prompts).toEqual(['1', '2', '3'])
    expect(
      storyForPictures({stories: [{prompts: ['1', '2', '3']}]}, 4)
    ).toBeNull()
    expect(storyForPictures({stories: [{prompts: ['a']}]})).toBeNull()
    expect(storyForPictures(null)).toBeNull()
  })
})

describe('a declined step', () => {
  test('undoes what the step wrote, and Submit and Delete are not proposed again on the same flip', () => {
    expect(declinedChange('flipStory', draft('story'))).toEqual({remove: true})
    expect(declinedChange('flipPictures', draft('pictures'))).toMatchObject({
      images: [undefined, undefined, undefined, undefined],
      agentFlip: {stage: 'story', waiting: null},
    })
    const drafted = draft('drafted')
    expect(declinedChange('flipDraft', drafted)).toMatchObject({
      order: drafted.originalOrder,
      agentFlip: {stage: 'pictures', waiting: null},
    })
    const ok = passed(drafted, {waiting: 'item'})
    expect(declinedChange('flipJudge', ok).agentVerdict).toMatchObject({
      waiting: null,
      declined: true,
    })
    const after = {...ok, ...declinedChange('flipSubmit', passed(drafted))}
    expect(draftsAt('flipSubmit', [after])).toEqual([])
  })

  test('a draft waiting on an item no longer in To approve is found', () => {
    const waiting = draft('story', {
      id: 'w',
      agentFlip: {
        by: 'a1',
        stage: 'story',
        waiting: {step: 'flipStory', id: 'gone'},
      },
    })
    const judged = passed(draft('drafted', {id: 'j', agentFlip: undefined}), {
      waiting: 'gone-too',
    })
    const live = draft('story', {
      id: 'live',
      agentFlip: {
        by: 'a1',
        stage: 'story',
        waiting: {step: 'flipStory', id: 'here'},
      },
    })
    expect(
      orphans([waiting, judged, live], ['here']).map(({flip, step}) => [
        flip.id,
        step,
      ])
    ).toEqual([
      ['w', 'flipStory'],
      ['j', 'flipJudge'],
    ])
  })

  test('the steps an agent holds, in the run order', () => {
    expect(
      heldFlipSteps({
        actions: {
          flipSubmit: {level: 'alone'},
          flipStory: {level: 'ask'},
          flipJudge: {level: 'off'},
          post: {level: 'alone'},
        },
      })
    ).toEqual(['flipStory', 'flipSubmit'])
  })
})

// B-277: sent flips.
describe('sent flips', () => {
  const sent = (fields = {}) =>
    draft('drafted', {
      id: 'sent',
      type: FlipType.Published,
      hash: 'bafy-sent',
      agentFlip: undefined,
      ...fields,
    })
  // This epoch's sent flips, as the node lists them for the identity; an agent may delete one.
  const ctx = {sent: ['bafy-sent'], judgeSent: true}

  test('the judge also takes a sent flip of this epoch without a verdict on it as it is', () => {
    expect(draftsAt('flipJudge', [sent()], ctx).map(({id}) => id)).toEqual([
      'sent',
    ])
    // Passed before it was sent (an agent's): not judged again.
    expect(draftsAt('flipJudge', [passed(sent())], ctx)).toEqual([])
    // Being deleted, or waiting for the person's approval of its deletion: not judged.
    expect(
      draftsAt('flipJudge', [sent({type: FlipType.Deleting})], ctx)
    ).toEqual([])
    expect(
      draftsAt(
        'flipJudge',
        [sent({agentSent: {waiting: {step: 'flipDeleteSent', id: 'i'}}})],
        ctx
      )
    ).toEqual([])
    // No agent may delete one: nothing would read the verdict, it is not judged (each judgement is billed).
    expect(draftsAt('flipJudge', [sent()], {...ctx, judgeSent: false})).toEqual(
      []
    )
    // Another epoch's (not in the node's list): left alone.
    expect(draftsAt('flipJudge', [sent()], {...ctx, sent: []})).toEqual([])
  })

  test('Delete a sent flip takes a sent flip the judge failed, not one declined, waiting or being sent', () => {
    const failed = passed(sent(), {pass: false})
    expect(draftsAt('flipDeleteSent', [failed], ctx).map(({id}) => id)).toEqual(
      ['sent']
    )
    expect(draftsAt('flipDeleteSent', [failed], {...ctx, sent: []})).toEqual([])
    expect(draftsAt('flipDeleteSent', [passed(sent())], ctx)).toEqual([])
    const declined = {...failed, ...declinedChange('flipDeleteSent', failed)}
    expect(draftsAt('flipDeleteSent', [declined], ctx)).toEqual([])
    const waiting = {
      ...failed,
      agentSent: {waiting: {step: 'flipDeleteSent', id: 'i'}},
    }
    expect(draftsAt('flipDeleteSent', [waiting], ctx)).toEqual([])
    expect(orphans([waiting], []).map(({step}) => step)).toEqual([
      'flipDeleteSent',
    ])
    // Deleted by the person meanwhile (a draft again): its wait is still settled.
    expect(
      orphans([{...waiting, type: FlipType.Draft}], []).map(({step}) => step)
    ).toEqual(['flipDeleteSent'])
    const sending = {...failed, agentSent: {sending: true}}
    expect(draftsAt('flipDeleteSent', [sending], ctx)).toEqual([])
    // A draft the judge failed is Delete a draft's, never this one's.
    expect(
      draftsAt('flipDeleteSent', [passed(draft('drafted'), {pass: false})], ctx)
    ).toEqual([])
  })
})

// B-284: what the Flips list says of a draft, and a failed draft's rewrites.
describe('a draft in the Flips list', () => {
  const base = {
    id: 'f',
    type: FlipType.Draft,
    keywordPairId: 2,
    originalOrder: [0, 3, 1, 2],
    order: [2, 1, 3, 0],
    protectedImages: ['a', 'b', 'c', 'd'],
  }
  const withVerdict = (flip, verdict) => ({
    ...flip,
    agentVerdict: {
      contents: contentsKey(flip),
      waiting: null,
      declined: false,
      ...verdict,
    },
  })
  const agents = (mark = {}) => ({
    ...base,
    agentFlip: {by: 'a1', stage: 'drafted', waiting: null, ...mark},
  })

  test('a flip no agent touched has nothing to say', () => {
    expect(draftStatus(base)).toBeNull()
    expect(draftStatus({...agents(), type: FlipType.Published})).toBeNull()
    expect(draftStatus(null)).toBeNull()
  })

  test("the person's own draft says its verdict, and only while the flip is as judged", () => {
    const judged = withVerdict(base, {pass: false})
    expect(draftStatus(judged)).toMatchObject({
      step: null,
      verdict: {pass: false},
    })
    expect(draftStatus({...judged, order: [1, 2, 0, 3]})).toBeNull()
  })

  test("an agent's draft says the step it waits for", () => {
    const step = (flip) => draftStatus(flip).step
    expect(step(agents({stage: 'story'}))).toBe('pictures')
    expect(step(agents({stage: 'pictures'}))).toBe('protection')
    expect(step(agents())).toBe('evaluation')
    expect(step(withVerdict(agents(), {pass: true}))).toBe('sending')
    expect(step(withVerdict(agents(), {pass: false}))).toBe('rewrite')
    expect(step(agents({waiting: {step: 'flipDraft', id: 'i'}}))).toBe(
      'approval'
    )
    expect(step(withVerdict(agents(), {pass: true, waiting: 'i'}))).toBe(
      'approval'
    )
  })

  test('a failed draft left after its rewrites says so, with their number', () => {
    const failed = withVerdict(agents({rewrites: 2}), {pass: false})
    const left = {
      ...failed,
      agentFlip: {...failed.agentFlip, gaveUp: contentsKey(failed)},
    }
    expect(draftStatus(left)).toMatchObject({step: 'left', rewrites: 2})
    expect(draftStatus(failed)).toMatchObject({step: 'rewrite', rewrites: 2})
  })

  test('the rewrites allowed: the number set on Write flip stories, 2 without one', () => {
    const agent = (row) => ({actions: {flipStory: row}})
    expect(rewritesAllowed(agent({level: 'alone'}))).toBe(2)
    expect(rewritesAllowed(agent({level: 'alone', rewrites: 0}))).toBe(0)
    expect(rewritesAllowed(agent({level: 'alone', rewrites: 4}))).toBe(4)
    expect(rewritesAllowed({actions: {}})).toBe(2)
  })

  test('a failed draft is taken to be written again, but not one whose new story the person declined', () => {
    const failed = withVerdict(agents(), {pass: false})
    expect(draftsAt('flipRewrite', [failed])).toHaveLength(1)
    expect(
      draftsAt('flipRewrite', [withVerdict(agents(), {pass: true})])
    ).toHaveLength(0)
    const proposed = {
      ...failed,
      agentFlip: {
        ...failed.agentFlip,
        waiting: {step: 'flipStory', id: 'i'},
        proposed: {story: {}, pictures: 3, by: 'a1'},
      },
    }
    expect(draftsAt('flipRewrite', [proposed])).toHaveLength(0)
    // Declined: the draft stays, as it was, and is not proposed again.
    const change = declinedChange('flipStory', proposed)
    expect(change.remove).toBeUndefined()
    const after = {...proposed, ...change}
    expect(after.agentFlip).toMatchObject({waiting: null, proposed: null})
    expect(draftsAt('flipRewrite', [after])).toHaveLength(0)
    // A new draft's declined story still removes the draft.
    expect(declinedChange('flipStory', agents({stage: 'story'}))).toEqual({
      remove: true,
    })
  })
})
