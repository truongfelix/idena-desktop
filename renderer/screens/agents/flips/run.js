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
  sameDraft,
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

// The flips (or keyword pairs) whose step failed today, in this window: not tried again before tomorrow, so that a
// model that keeps failing is not billed at every run (a failure is not counted against the step's limit).
const failedToday = new Map()

/**
 * One action of a step on one flip: may it (mayDo), its work (`work()`, the model's part; null: nothing to propose),
 * then, the draft still as it was (`fresh()`: nothing written over a change made meanwhile), propose; `apply(result,
 * waiting)` writes it into the draft (waiting: the item of To approve, or null alone). `key` names the flip (or pair)
 * for the failures of the day. Returns 'stop' when the step can do no more in this run (Off, past its limit, To
 * approve full), else 'next'.
 */
async function act(
  agent,
  step,
  deps,
  count,
  {key, work, fresh, propose, apply, billed = true}
) {
  const day = new Date(deps.now()).toDateString()
  const failure = `${agent.id}:${step}:${key}`
  // Held (its billed work failed today): counted, so a run does not read as having found nothing.
  if (failedToday.get(failure) === day) {
    count.skipped += 1
    return 'next'
  }
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
  const fail = async (error) => {
    count.failed += 1
    // Only billed work is held for the day (`billed`: a model's answer, a picture).
    if (billed) failedToday.set(failure, day)
    if (!logged(error))
      await deps.call('didAction', {
        agentId: agent.id,
        action: step,
        ok: false,
        detail: String(error?.message || error),
      })
  }
  let result
  try {
    result = work ? await work() : {}
  } catch (error) {
    await fail(error)
    return 'next'
  }
  if (!result) return 'next'
  if (fresh && !fresh()) {
    count.skipped += 1
    await deps.call('didAction', {
      agentId: agent.id,
      action: step,
      skipped: true,
      detail: 'the draft changed meanwhile: not written over',
    })
    return 'next'
  }
  // `cost`: the iDNA the action may spend, fees included (B-277); the other steps spend nothing.
  // `wait`: past its iDNA a day, the action waits in To approve for the person (B-269) instead of being skipped.
  const {
    body = '',
    detail = '',
    target,
    cost = 0,
    wait = false,
  } = propose(result)
  const decision = await deps.call('propose', {
    agentId: agent.id,
    action: step,
    body,
    detail,
    target,
    amount: 1,
    cost,
    skipOverLimit: !wait,
  })
  if (decision.decision === 'ask' && decision.item) {
    try {
      await apply(result, {step, id: decision.item.id})
      count.ask += 1
    } catch (error) {
      // No draft waits on the item: it leaves To approve.
      await deps
        .call('withdraw', {
          id: decision.item.id,
          agentId: agent.id,
          reason: String(error?.message || error),
        })
        .catch(() => {})
      await fail(error)
    }
    return 'next'
  }
  // Refused (Off, past its limit, To approve full): the step does no more in this run.
  if (decision.decision !== 'alone') {
    count.skipped += 1
    return 'stop'
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
    // Not remembered: what failed here is the app's part (a node briefly away), tried again at the next run.
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
        key: `pair ${pair.id}`,
        // The pair still free: no draft took it meanwhile (the person's in the editor).
        fresh: () =>
          freePairs(ctx.identity, deps.store.getFlips()).some(
            ({id}) => id === pair.id
          ),
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
        key: flip.id,
        fresh: () => sameDraft(deps.store.getFlip(flip.id), flip),
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
        key: flip.id,
        fresh: () => sameDraft(deps.store.getFlip(flip.id), flip),
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
        key: flip.id,
        fresh: () => sameDraft(deps.store.getFlip(flip.id), flip),
        work: async () => {
          const {flip: question, storySide} = judgeQuestion(flip, deps.random)
          const answer = await deps.ipc('judgeFlip', {
            agentId: agent.id,
            flip: question,
          })
          // An answer it could not read (cut short, in prose) carries nothing: no verdict, or a failed flip would be
          // deleted. One that picks no side but reports the flip, or marks its keywords, is a verdict.
          if (
            !answer ||
            (!answer.answer &&
              !answer.relevance &&
              !answer.report &&
              !(answer.reasons && answer.reasons.length))
          )
            throw new Error('the answer could not be read')
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
        key: flip.id,
        fresh: () => sameDraft(deps.store.getFlip(flip.id), flip),
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
        key: flip.id,
        // Reworked since the judge failed it: not deleted.
        fresh: () => sameDraft(deps.store.getFlip(flip.id), flip),
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
  /**
   * Delete a sent flip (B-277): a sent flip the judge failed, as it is, the person's too; its fee, estimated by the
   * node, counts in the action's iDNA a day (past it, or without a limit, it waits in To approve for the person).
   */
  async flipDeleteSent(agent, ctx, deps, count) {
    if (!canMakeFlips(ctx.identity, ctx.epoch)) return
    // eslint-disable-next-line no-restricted-syntax
    for (const flip of draftsAt('flipDeleteSent', deps.store.getFlips())) {
      // eslint-disable-next-line no-await-in-loop
      const next = await act(agent, 'flipDeleteSent', deps, count, {
        key: flip.id,
        fresh: () => sameDraft(deps.store.getFlip(flip.id), flip),
        // The node's dry run, billed nothing: a failure is tried again at the next run.
        billed: false,
        work: () => deps.deleteCost(flip),
        propose: (cost) => ({
          // Past its iDNA a day, it waits for the person: the flip is marked, it is never proposed twice.
          wait: true,
          body: deps.verdictText(flip.agentVerdict),
          detail: keywordsLine(flip),
          target: {flipId: flip.id},
          cost: cost.maxFee,
        }),
        apply: async (cost, waiting) => {
          if (waiting) {
            deps.store.updateDraft({
              id: flip.id,
              agentSent: {...(flip.agentSent || {}), waiting},
            })
            return ''
          }
          return deps.deleteSent(flip.id, cost)
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
  // The failures of earlier days are forgotten.
  const today = new Date(deps.now()).toDateString()
  failedToday.forEach((day, key) => day !== today && failedToday.delete(key))
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
