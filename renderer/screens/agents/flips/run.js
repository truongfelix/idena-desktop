import {FlipType} from '../../../shared/types'
import {placeAdversarial} from '../../flips/utils'
import {draftStory, freeSlots, storyWords} from '../flip-story'
import {
  STORY_PICTURES,
  canMakeFlips,
  draftsAt,
  freePairs,
  heldFlipSteps,
  judgeQuestion,
  orphans,
  permutationsOf,
  shuffledOrder,
  storyForPictures,
  verdictOf,
} from './drafts'

// A Flips run of an agent (B-258): each step it holds, in order (FLIP_STEPS), on the drafts waiting at that step.
// Each action is checked before its work is asked of the model (mayDo: a step past its limit bills nothing), then
// proposed as any action of an agent (main/agent/pending.js): alone, its result goes into the draft at once; with Ask
// me, it goes into the draft marked as waiting for the person (To approve), and the next step waits for their click.

/** The reasons an action Alone would wait for the person (pending.js OVER_LIMIT): the step stops for this run. */
const OVER_LIMIT = [
  'above the limit',
  'above its daily iDNA',
  'above the budget',
  'no budget',
  'cost unknown',
  'count unknown',
]

/** An error the main process already wrote in Activity (a model's answer that failed). */
const logged = (error) => Boolean(error && error.logged)

const keywordsLine = (flip) =>
  ((flip.keywords && flip.keywords.words) || [])
    .map(({name}) => name)
    .filter(Boolean)
    .join(' / ')

/**
 * The drafts waiting on an item no longer in To approve, settled as declined (`settle`, execute.js): a flip never
 * stays stuck on an approval nobody can give.
 */
async function settleOrphans(deps) {
  const items = await deps.call('pending')
  const ids = (Array.isArray(items) ? items : []).map(({id}) => id)
  orphans(deps.store.getFlips(), ids).forEach(({flip, step}) =>
    deps.settle(flip.id, step)
  )
}

/**
 * One action of a step on one flip: may it (mayDo), its work (`work()`, the model's part; null: nothing to propose),
 * then propose; `apply(result, waiting)` writes it into the draft (waiting: the item of To approve, or null alone).
 * Returns 'stop' when the step can do no more in this run (Off, past its limit), else 'next'.
 */
async function act(agent, step, deps, count, {work, propose, apply}) {
  const may = await deps.call('mayDo', {agentId: agent.id, action: step})
  if (may.decision === 'off') return 'stop'
  if (may.decision === 'ask' && OVER_LIMIT.includes(may.reason)) {
    count.skipped += 1
    await deps.call('didAction', {
      agentId: agent.id,
      action: step,
      skipped: true,
      detail: may.reason,
    })
    return 'stop'
  }
  let result
  try {
    result = work ? await work() : {}
  } catch (error) {
    count.failed += 1
    if (!logged(error))
      await deps.call('didAction', {
        agentId: agent.id,
        action: step,
        ok: false,
        detail: String(error?.message || error),
      })
    return 'next'
  }
  if (!result) return 'next'
  const {body = '', detail = '', target} = propose(result)
  const decision = await deps.call('propose', {
    agentId: agent.id,
    action: step,
    body,
    detail,
    target,
    amount: 1,
    cost: 0,
    skipOverLimit: true,
  })
  if (decision.decision === 'ask' && decision.item) {
    apply(result, {step, id: decision.item.id})
    count.ask += 1
    return 'next'
  }
  if (decision.decision !== 'alone') {
    count.skipped += 1
    return OVER_LIMIT.includes(decision.reason) ? 'stop' : 'next'
  }
  try {
    const done = await apply(result, null)
    count.alone += 1
    await deps.call('didAction', {
      agentId: agent.id,
      action: step,
      ok: true,
      detail: [detail, done].filter(Boolean).join(' · '),
    })
  } catch (error) {
    count.failed += 1
    // Never done (refused before it reached the chain): its count is given back to the day.
    await deps.call('didAction', {
      agentId: agent.id,
      action: step,
      ok: false,
      release: !error?.sent,
      detail: String(error?.message || error),
    })
  }
  return 'next'
}

/** A new agent draft for `pair`, its story written: the nonsense picture's slot picked as the editor picks it. */
export function newAgentDraft({id, pair, words, story, by, at, random}) {
  const start = {originalOrder: [0, 1, 2, 3], adversarialImageId: 3}
  const {originalOrder} = {...start, ...placeAdversarial(start, random)}
  return {
    id,
    type: FlipType.Draft,
    createdAt: at,
    modifiedAt: at,
    keywordPairId: pair.id,
    keywords: {id: pair.id, words, translations: [[], []]},
    images: Array.from({length: 4}, () => null),
    protectedImages: Array.from({length: 4}, () => null),
    noise: Array.from({length: 4}, () => null),
    adversarialImage: '',
    adversarialImageId: 3,
    adversarialPlaced: true,
    originalOrder,
    order: originalOrder,
    orderPermutations: permutationsOf(originalOrder, originalOrder),
    story,
    agentFlip: {by, stage: 'story', waiting: null, declined: {}},
  }
}

const STEPS = {
  /** Write the story: a new draft for each free keyword pair, while there are flips left to make. */
  async flipStory(agent, ctx, deps, count) {
    if (!canMakeFlips(ctx.identity, ctx.epoch)) return
    // eslint-disable-next-line no-restricted-syntax
    for (const pair of freePairs(ctx.identity, deps.store.getFlips())) {
      let words
      // eslint-disable-next-line no-await-in-loop
      const next = await act(agent, 'flipStory', deps, count, {
        work: async () => {
          words = await deps.loadWords(pair)
          const sent = storyWords({words})
          if (!sent) throw new Error('the keywords could not be read')
          const written = await deps.ipc('writeStory', {
            agentId: agent.id,
            words: sent,
            parts: ['story', 'prompts'],
          })
          const one = storyForPictures(written)
          if (!one)
            throw new Error(
              `no story with ${STORY_PICTURES} image prompts in the answer`
            )
          return {
            one,
            story: draftStory({stories: [one]}, sent, {
              idea: '',
              parts: ['story', 'prompts'],
              titles: [],
            }),
            id: deps.newId(),
          }
        },
        propose: ({one, id}) => ({
          body: [one.title, one.story].filter(Boolean).join('\n\n'),
          detail: words.map(({name}) => name).join(' / '),
          target: {flipId: id},
        }),
        apply: ({story, id}, waiting) => {
          const draft = newAgentDraft({
            id,
            pair,
            words,
            story,
            by: agent.id,
            at: new Date(deps.now()).toISOString(),
            random: deps.random,
          })
          deps.store.addDraft({
            ...draft,
            agentFlip: {...draft.agentFlip, waiting},
          })
        },
      })
      if (next === 'stop') return
    }
  },

  /** Make the pictures: the story's pictures drawn into the free slots, in the story's order. */
  async flipPictures(agent, ctx, deps, count) {
    // eslint-disable-next-line no-restricted-syntax
    for (const flip of draftsAt('flipPictures', deps.store.getFlips())) {
      // eslint-disable-next-line no-await-in-loop
      const next = await act(agent, 'flipPictures', deps, count, {
        work: async () => {
          const one = storyForPictures(flip.story)
          if (!one) throw new Error('the draft has no story to draw')
          const slots = freeSlots(flip.originalOrder, flip.adversarialImageId)
          const images = Array.from({length: 4}, () => null)
          // One after the other: a service drawing one at a time is not asked for three at once.
          for (let i = 0; i < STORY_PICTURES; i += 1)
            // eslint-disable-next-line no-await-in-loop
            images[slots[i].slot] = await deps.draw(agent.id, one.prompts[i])
          return {images}
        },
        propose: () => ({
          detail: keywordsLine(flip),
          target: {flipId: flip.id},
        }),
        apply: ({images}, waiting) => {
          deps.store.updateDraft({
            id: flip.id,
            images,
            modifiedAt: new Date(deps.now()).toISOString(),
            agentFlip: {...flip.agentFlip, stage: 'pictures', waiting},
          })
        },
      })
      if (next === 'stop') return
    }
  },

  /** Draft the flip: protected as the editor's Protect step does it (its nonsense picture setting), then shuffled. */
  async flipDraft(agent, ctx, deps, count) {
    // eslint-disable-next-line no-restricted-syntax
    for (const flip of draftsAt('flipDraft', deps.store.getFlips())) {
      // eslint-disable-next-line no-await-in-loop
      const next = await act(agent, 'flipDraft', deps, count, {
        work: async () => {
          const shield = await deps.protect(flip)
          if (!shield.protectedImages.every(Boolean))
            throw new Error('the pictures could not be protected')
          const order = shuffledOrder(
            flip.originalOrder,
            flip.adversarialImageId,
            deps.random
          )
          return {...shield, order}
        },
        propose: () => ({
          detail: keywordsLine(flip),
          target: {flipId: flip.id},
        }),
        apply: ({protectedImages, adversarialImage, noise, order}, waiting) => {
          deps.store.updateDraft({
            id: flip.id,
            protectedImages,
            adversarialImage,
            noise,
            order,
            orderPermutations: permutationsOf(flip.originalOrder, order),
            modifiedAt: new Date(deps.now()).toISOString(),
            agentFlip: {...flip.agentFlip, stage: 'drafted', waiting},
          })
        },
      })
      if (next === 'stop') return
    }
  },

  /** Judge the flip: the validation's question on each draft protected and shuffled, its verdict kept with it. */
  async flipJudge(agent, ctx, deps, count) {
    // eslint-disable-next-line no-restricted-syntax
    for (const flip of draftsAt('flipJudge', deps.store.getFlips())) {
      // eslint-disable-next-line no-await-in-loop
      const next = await act(agent, 'flipJudge', deps, count, {
        work: async () => {
          const {flip: question, storySide} = judgeQuestion(flip, deps.random)
          const answer = await deps.ipc('judgeFlip', {
            agentId: agent.id,
            flip: question,
          })
          return verdictOf(answer, {
            storySide,
            flip,
            by: agent.id,
            at: deps.now(),
          })
        },
        propose: (verdict) => ({
          body: deps.verdictText(verdict),
          detail: keywordsLine(flip),
          target: {flipId: flip.id},
        }),
        apply: (verdict, waiting) => {
          deps.store.updateDraft({
            id: flip.id,
            agentVerdict: {...verdict, waiting: waiting ? waiting.id : null},
          })
          return deps.verdictText(verdict)
        },
      })
      if (next === 'stop') return
    }
  },

  /** Submit the flip: a draft the judge passed, as it is, while the identity may still send flips. */
  async flipSubmit(agent, ctx, deps, count) {
    if (!canMakeFlips(ctx.identity, ctx.epoch)) return
    // eslint-disable-next-line no-restricted-syntax
    for (const flip of draftsAt('flipSubmit', deps.store.getFlips())) {
      // eslint-disable-next-line no-await-in-loop
      const next = await act(agent, 'flipSubmit', deps, count, {
        propose: () => ({
          detail: keywordsLine(flip),
          target: {flipId: flip.id},
        }),
        apply: async (_, waiting) => {
          if (waiting) {
            deps.store.updateDraft({
              id: flip.id,
              agentFlip: {...flip.agentFlip, waiting},
            })
            return ''
          }
          return deps.submit(flip.id)
        },
      })
      if (next === 'stop') return
    }
  },

  /** Delete a draft: an agent's draft the judge failed. */
  async flipDelete(agent, ctx, deps, count) {
    // eslint-disable-next-line no-restricted-syntax
    for (const flip of draftsAt('flipDelete', deps.store.getFlips())) {
      // eslint-disable-next-line no-await-in-loop
      const next = await act(agent, 'flipDelete', deps, count, {
        propose: () => ({
          body: deps.verdictText(flip.agentVerdict),
          detail: keywordsLine(flip),
          target: {flipId: flip.id},
        }),
        apply: (_, waiting) => {
          if (waiting) {
            deps.store.updateDraft({
              id: flip.id,
              agentFlip: {...flip.agentFlip, waiting},
            })
            return ''
          }
          deps.store.deleteDraft(flip.id)
          return ''
        },
      })
      if (next === 'stop') return
    }
  },
}

/**
 * A Flips run of `agent`: `ctx` {identity, epoch}; `deps` the app's side (execute.js flipsDeps): call (the agent
 * channel), ipc (a model's command: its failure is in Activity already), store (the flip store), loadWords(pair),
 * draw(agentId, prompt) (a picture as a flip frame), protect(flip), submit(flipId), settle(flipId, step),
 * verdictText(verdict), newId, now, random. Returns {result, detail, count}.
 */
export async function runFlipsAgent(agent, ctx, deps) {
  const held = heldFlipSteps(agent)
  if (!held.length) return {result: 'off', detail: ''}
  await settleOrphans(deps)
  const count = {alone: 0, ask: 0, skipped: 0, failed: 0}
  // eslint-disable-next-line no-restricted-syntax
  // eslint-disable-next-line no-await-in-loop
  for (const step of held) await STEPS[step](agent, ctx, deps, count)
  const acted = count.alone + count.ask + count.skipped + count.failed
  if (!acted) return {result: 'nothing new', detail: '', count}
  return {
    result: 'done',
    detail: deps.t(
      '{{alone}} done alone, {{ask}} in To approve, {{skipped}} not done, {{failed}} failed',
      {...count, nsSeparator: '!!'}
    ),
    count,
  }
}
