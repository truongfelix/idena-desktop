import {FlipType} from '../../../shared/types'
import {areEqual, areEqualExceptOne} from '../../../shared/utils/arr'

// The Flips area's steps as an agent's actions (B-258, owner 2026-11-16): Write the story, Make the pictures, Draft
// the flip, Judge the flip, Submit the flip, Delete a draft. Each is a right of its own; agents hand a flip over from
// one step to the next through the drafts of the flip store. A draft an agent started carries `agentFlip`:
// {by: the agent's id, stage, waiting, declined}; any draft the judge saw carries `agentVerdict`. The judge may judge
// the person's own drafts (it changes nothing in them); every other step touches only drafts an agent started.

/** The steps, in the order a run does them: one agent holding them all takes a flip from its story to the chain. */
export const FLIP_STEPS = [
  'flipStory',
  'flipPictures',
  'flipDraft',
  'flipJudge',
  'flipSubmit',
  'flipDelete',
]

/** Where an agent's draft is: its story written, its pictures drawn, protected and shuffled, sent to the chain. */
export const STAGES = ['story', 'pictures', 'drafted', 'submitted']

/** The story pictures of a flip: the fourth is the nonsense picture, as a new flip in the editor has it. */
export const STORY_PICTURES = 3

/** The Flips steps the agent holds (not Off), in the run's order. */
export const heldFlipSteps = (agent) =>
  FLIP_STEPS.filter(
    (id) => agent.actions[id] && agent.actions[id].level !== 'off'
  )

/** Whether the draft is an agent's, and still a draft (not sent, not removed, not archived). */
export const isAgentDraft = (flip) =>
  Boolean(flip) &&
  flip.type === FlipType.Draft &&
  Boolean(flip.agentFlip) &&
  typeof flip.agentFlip.by === 'string' &&
  STAGES.includes(flip.agentFlip.stage)

/** The draft's step waiting in To approve, or null. */
export const waitingOf = (flip) =>
  (flip && flip.agentFlip && flip.agentFlip.waiting) || null

/** A short hash of a text (FNV-1a, 32 bits), as hex. */
function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // eslint-disable-next-line no-bitwise
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * What the judge saw of the flip: its keywords, its pictures as sent, its two orders. A verdict holds only while this
 * is the same: a picture, the order or the keywords changed, and the flip is judged again.
 */
export function contentsKey(flip) {
  const {keywordPairId, originalOrder, order, protectedImages} = flip || {}
  return hash(
    JSON.stringify([
      keywordPairId ?? null,
      originalOrder || [],
      order || [],
      (protectedImages || []).map((src) => (src ? hash(String(src)) : '')),
    ])
  )
}

/** Whether the flip is protected and shuffled: four protected pictures and an order that is not the story's. */
export function isShuffled(flip) {
  const {protectedImages, originalOrder, order} = flip || {}
  return (
    Array.isArray(protectedImages) &&
    protectedImages.length === 4 &&
    protectedImages.every(Boolean) &&
    Array.isArray(originalOrder) &&
    Array.isArray(order) &&
    order.length === 4 &&
    order.join() !== originalOrder.join()
  )
}

/** The draft's verdict when it is about the flip as it is now (nothing changed since), else null. */
export function currentVerdict(flip) {
  const verdict = flip && flip.agentVerdict
  if (!verdict || verdict.contents !== contentsKey(flip)) return null
  return verdict
}

/** Whether the judge passed the flip as it is now, and its verdict holds (not waiting for the person, not declined). */
export function judgedPass(flip) {
  const verdict = currentVerdict(flip)
  return Boolean(
    verdict && verdict.pass && !verdict.waiting && !verdict.declined
  )
}

/** Whether the judge failed the flip as it is now, and its verdict holds. */
export function judgedFail(flip) {
  const verdict = currentVerdict(flip)
  return Boolean(
    verdict && !verdict.pass && !verdict.waiting && !verdict.declined
  )
}

/** Whether the person declined this step on the flip as it is now (Submit, Delete): it is not proposed again. */
const declinedNow = (flip, step) =>
  Boolean(
    flip.agentFlip &&
      flip.agentFlip.declined &&
      flip.agentFlip.declined[step] === contentsKey(flip)
  )

const atStage = (flip, stage) =>
  isAgentDraft(flip) && flip.agentFlip.stage === stage && !waitingOf(flip)

/**
 * The drafts waiting at `step`, oldest first:
 * - flipPictures: an agent's draft with its story, no pictures yet;
 * - flipDraft: an agent's draft with its pictures;
 * - flipJudge: any draft protected and shuffled (the person's too) without a verdict on it as it is;
 * - flipSubmit: an agent's draft the judge passed as it is;
 * - flipDelete: an agent's draft the judge failed as it is.
 * Write the story makes new drafts (freePairs), it takes none.
 */
export function draftsAt(step, flips) {
  const list = (Array.isArray(flips) ? flips : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    )
  switch (step) {
    case 'flipPictures':
      return list.filter((flip) => atStage(flip, 'story'))
    case 'flipDraft':
      return list.filter((flip) => atStage(flip, 'pictures'))
    case 'flipJudge':
      return list.filter(
        (flip) =>
          flip.type === FlipType.Draft &&
          // An agent's draft waiting in To approve for another step is judged once that is settled.
          !(isAgentDraft(flip) && waitingOf(flip)) &&
          isShuffled(flip) &&
          !currentVerdict(flip)
      )
    case 'flipSubmit':
      return list.filter(
        (flip) =>
          atStage(flip, 'drafted') &&
          judgedPass(flip) &&
          !declinedNow(flip, step)
      )
    case 'flipDelete':
      return list.filter(
        (flip) =>
          atStage(flip, 'drafted') &&
          judgedFail(flip) &&
          !declinedNow(flip, step)
      )
    default:
      return []
  }
}

/** The flips that hold a keyword pair this epoch: a draft, one being sent, one sent. */
const HOLDING = [FlipType.Draft, FlipType.Publishing, FlipType.Published]

/** Whether the identity may make flips now: a validated state, and no validation going on. */
export function canMakeFlips(identity, epoch) {
  return Boolean(
    identity &&
      ['Newbie', 'Verified', 'Human'].includes(identity.state) &&
      epoch &&
      epoch.currentPeriod === 'None'
  )
}

/**
 * The keyword pairs a new agent draft may take (Write the story), at most as many as flips are left to make: pairs not
 * used, held by no flip (the person's drafts included), and room left after the flips sent and the agents' drafts on
 * the way.
 */
export function freePairs(identity, flips) {
  const pairs = Array.isArray(identity && identity.flipKeyWordPairs)
    ? identity.flipKeyWordPairs
    : []
  const all = Array.isArray(flips) ? flips.filter(Boolean) : []
  const held = new Set(
    all
      .filter((flip) => HOLDING.includes(flip.type))
      .map((flip) => flip.keywordPairId)
  )
  const sent = Array.isArray(identity && identity.flips)
    ? identity.flips.length
    : 0
  const onTheWay = all.filter(
    (flip) => isAgentDraft(flip) && flip.agentFlip.stage !== 'submitted'
  ).length
  const room = Number(identity && identity.availableFlips) - sent - onTheWay
  if (!(room > 0)) return []
  return pairs
    .filter(
      (pair) =>
        pair &&
        Number.isInteger(pair.id) &&
        Array.isArray(pair.words) &&
        pair.words.length === 2 &&
        !pair.used &&
        !held.has(pair.id)
    )
    .slice(0, room)
}

/** The first story with enough prompts for the flip's pictures, with only those prompts; null without one. */
export function storyForPictures(story) {
  const stories = (story && Array.isArray(story.stories) && story.stories) || []
  const one = stories.find(
    (item) =>
      item &&
      Array.isArray(item.prompts) &&
      item.prompts.length >= STORY_PICTURES
  )
  return one ? {...one, prompts: one.prompts.slice(0, STORY_PICTURES)} : null
}

/** An order of the four pictures for the flip's shuffled side: any but the story's, and not the story's with one moved. */
export function shuffledOrder(
  originalOrder,
  adversarialImageId,
  random = Math.random
) {
  // The story's order, or the story's but for the nonsense picture's place: publishFlip refuses both.
  const refused = (order) =>
    areEqual(order, originalOrder) ||
    areEqualExceptOne(originalOrder, order, adversarialImageId)
  for (let i = 0; i < 100; i += 1) {
    const order = originalOrder.slice()
    for (let j = order.length - 1; j > 0; j -= 1) {
      const k = Math.floor(random() * (j + 1))
      ;[order[j], order[k]] = [order[k], order[j]]
    }
    if (!refused(order)) return order
  }
  // A random source that never shuffles: the story's order turned round, never refused.
  return originalOrder.slice().reverse()
}

/** Where each picture of `order` is in the story's order (the editor's changeOrder). */
export const permutationsOf = (originalOrder, order) =>
  order.map((n) => originalOrder.findIndex((o) => o === n))

/**
 * The flip as the judge is asked it (main/agent/flips.js checkFlip): its pictures as sent, the story's order and the
 * shuffled one, on a side at random, its keywords. `storySide`: the side of the story's order, the right answer.
 */
export function judgeQuestion(flip, random = Math.random) {
  const images = flip.protectedImages.map(
    (src) => String(src).split(',')[1] || ''
  )
  const storyLeft = random() < 0.5
  const orders = storyLeft
    ? [flip.originalOrder, flip.order]
    : [flip.order, flip.originalOrder]
  const words = ((flip.keywords && flip.keywords.words) || [])
    .slice(0, 2)
    .map(({name, desc}) => ({name: name || '', desc: desc || ''}))
  return {
    flip: {images, orders, words},
    storySide: storyLeft ? 'left' : 'right',
  }
}

/**
 * The verdict on the judge's answer (main/agent/flips.js readFlipAnswer): it passes when the model found the story's
 * side, saw both keywords and found no rule to report. Kept with the flip as it is (`contents`).
 */
export function verdictOf(answer, {storySide, flip, by, at}) {
  const found = answer && answer.answer === storySide
  const shown = answer && answer.relevance === 'relevant'
  const reported = Boolean(answer && answer.report)
  return {
    contents: contentsKey(flip),
    by,
    at,
    pass: Boolean(found && shown && !reported),
    found: Boolean(found),
    shown: Boolean(shown),
    reasons: (answer && Array.isArray(answer.reasons) ? answer.reasons : [])
      .slice(0, 9)
      .map(({reason, confidence}) => ({reason, confidence})),
    reported,
    quality:
      answer && typeof answer.quality === 'number' ? answer.quality : null,
    waiting: null,
    declined: false,
  }
}

/**
 * What a declined step undoes in the draft (To approve's Decline, or an item gone from it): the fields to write, or
 * `{remove: true}` for a new draft whose story was declined.
 */
export function declinedChange(step, flip) {
  const mark = flip.agentFlip || {}
  const keep = {...mark, waiting: null}
  switch (step) {
    case 'flipStory':
      return {remove: true}
    case 'flipPictures':
      return {
        images: Array.from({length: 4}),
        agentFlip: {...keep, stage: 'story'},
      }
    case 'flipDraft':
      return {
        protectedImages: Array.from({length: 4}),
        noise: Array.from({length: 4}),
        adversarialImage: '',
        order: flip.originalOrder,
        orderPermutations: permutationsOf(
          flip.originalOrder,
          flip.originalOrder
        ),
        agentFlip: {...keep, stage: 'pictures'},
      }
    case 'flipJudge':
      return {
        agentVerdict: {
          ...(flip.agentVerdict || {}),
          waiting: null,
          declined: true,
        },
      }
    case 'flipSubmit':
    case 'flipDelete':
      return {
        agentFlip: {
          ...keep,
          declined: {...(mark.declined || {}), [step]: contentsKey(flip)},
        },
      }
    default:
      return {}
  }
}

/** The item of To approve the draft waits on for `step`: its id, or null (the judge's on the verdict). */
export function waitingItem(flip, step) {
  if (step === 'flipJudge')
    return (flip.agentVerdict && flip.agentVerdict.waiting) || null
  const waiting = waitingOf(flip)
  return waiting && waiting.step === step ? waiting.id : null
}

/**
 * The drafts that wait on an item no longer in To approve (taken off it while the window was closed, or its action
 * turned Off): [{flip, step}], each to be settled as declined.
 */
export function orphans(flips, pendingIds) {
  const live = new Set(pendingIds)
  const out = []
  ;(Array.isArray(flips) ? flips : []).filter(Boolean).forEach((flip) => {
    const waiting = waitingOf(flip)
    if (isAgentDraft(flip) && waiting && !live.has(waiting.id))
      out.push({flip, step: waiting.step})
    const judged = flip.agentVerdict && flip.agentVerdict.waiting
    if (flip.type === FlipType.Draft && judged && !live.has(judged))
      out.push({flip, step: 'flipJudge'})
  })
  return out
}
