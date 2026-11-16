import {nanoid} from 'nanoid'
import {FlipType} from '../../../shared/types'
import {loadKeyword} from '../../../shared/utils/utils'
import {shuffle} from '../../../shared/utils/arr'
import {resizeImageToDataUrl} from '../../../shared/utils/image-canvas'
import {
  adversarialSearchNeeded,
  protectFlip,
  publishFlip,
} from '../../flips/utils'
import {IMAGE_SOURCES} from '../../flips/image-search-machine'
import {asFrame} from '../flip-story'
import {declinedChange, judgedFail, judgedPass, waitingItem} from './drafts'

// The app's side of a Flips run (B-258): the flip store, the drawing, the editor's own protect and publish code,
// and what To approve's Approve and Decline do to a draft waiting on them. Each acts on the draft as it is when
// called: a draft changed or removed since the agent proposed is refused, never overwritten.

const agentCall = (command, data) =>
  global.ipcRenderer.invoke('agent', command, data)

/** A command whose failure the main process writes in Activity itself: marked, so the run does not write it twice. */
const ipc = (command, data) =>
  agentCall(command, data).catch((error) => {
    const marked = error instanceof Error ? error : new Error(String(error))
    marked.logged = true
    throw marked
  })

const store = () => global.flipStore

/** The draft `flipId` as it is now; throws when it is gone. */
function draftNow(flipId) {
  const flip = store().getFlip(flipId)
  if (!flip || flip.type !== FlipType.Draft)
    throw new Error('the draft is gone')
  return flip
}

const keywordsOf = (flip) =>
  ((flip.keywords && flip.keywords.words) || [])
    .map(({name}) => name)
    .filter(Boolean)
    .join(' / ')

/** A verdict in words, as To approve and Activity show it. */
export function verdictText(verdict, t) {
  if (!verdict) return ''
  if (verdict.pass)
    return t('Passes: the story is found, both keywords shown', {
      nsSeparator: '!!',
    })
  const why = []
  if (!verdict.found) why.push(t("the story's order was not found"))
  if (!verdict.shown) why.push(t('the keywords are not clearly shown'))
  if (verdict.reported)
    why.push(
      t('reasons to report it: {{list}}', {
        list: verdict.reasons.map(({reason}) => reason).join(', '),
        nsSeparator: '!!',
      })
    )
  return t('Fails: {{why}}', {why: why.join('; '), nsSeparator: '!!'})
}

/**
 * The web pictures for the nonsense picture, as the editor's Protect step finds them (useAdversarialSearch): only
 * when its setting uses the search and the person allowed the search; up to eight, as PNG data URLs. None found, a
 * source failing: the nonsense picture is made from the story's pictures (adversarialSources).
 */
async function searchPictures(flip, settings) {
  const source = settings.flipAdversarialSource
  if (!adversarialSearchNeeded(source) || settings.imageSearch !== true)
    return []
  const words = (flip.keywords && flip.keywords.words) || []
  const query = `${words[0]?.name || ''} ${words[1]?.name || ''}`.trim()
  if (!query) return []
  const found = await Promise.all(
    IMAGE_SOURCES.map((one) =>
      global.ipcRenderer
        .invoke('search-image', query, one)
        .then((images) => (Array.isArray(images) ? images : []))
        .catch(() => [])
    )
  )
  const picked = shuffle(found.flat().filter((one) => one && one.thumbnail))
  const urls = await Promise.all(
    picked.slice(0, 8).map((one) =>
      resizeImageToDataUrl(one.thumbnail, {type: 'image/png', exact: false})
        .then((url) => url || null)
        .catch(() => null)
    )
  )
  return urls.filter(Boolean)
}

/** Submits the draft the judge passed, as it is: the editor's publishFlip, then the draft marked as being sent. */
async function submitDraft(flipId) {
  const flip = draftNow(flipId)
  if (!judgedPass(flip))
    throw new Error('the judge has not passed the flip as it is now')
  const {txHash, hash} = await publishFlip(flip)
  store().updateDraft({
    id: flip.id,
    txHash,
    hash,
    type: FlipType.Publishing,
    // The editable frames are not needed once the flip is sent (B-211).
    scenes: null,
    modifiedAt: new Date().toISOString(),
    agentFlip: {...flip.agentFlip, stage: 'submitted', waiting: null},
  })
  return hash || ''
}

/** A declined step settled on the draft (declinedChange); nothing when the draft is gone. */
function settle(flipId, step) {
  const flip = store().getFlip(flipId)
  if (!flip || flip.type !== FlipType.Draft) return
  const change = declinedChange(step, flip)
  if (change.remove) store().deleteDraft(flip.id)
  else store().updateDraft({id: flip.id, ...change})
}

/** What a Flips run needs of the app (run.js runFlipsAgent's deps): `settings` the app's, for the Protect step. */
export function flipsDeps({settings, t}) {
  return {
    call: agentCall,
    ipc,
    store: store(),
    loadWords: (pair) =>
      Promise.all(
        pair.words.map(async (id) => ({id, ...(await loadKeyword(id))}))
      ),
    draw: async (agentId, prompt) =>
      asFrame(await ipc('drawStoryPicture', {agentId, prompt})),
    protect: (flip) =>
      searchPictures(flip, settings || {}).then((adversarialImages) =>
        protectFlip({
          images: flip.images,
          originalOrder: flip.originalOrder,
          adversarialImageId: flip.adversarialImageId,
          adversarialImage: '',
          adversarialImages,
          adversarialSource: (settings || {}).flipAdversarialSource,
        })
      ),
    submit: submitDraft,
    settle,
    verdictText: (verdict) => verdictText(verdict, t),
    newId: nanoid,
    now: Date.now,
    random: Math.random,
    t,
  }
}

/**
 * The step of a draft waiting on `item` approved: the draft must still wait on that item (changed or gone: refused).
 * `done(flip)` does the rest and gives Activity's line.
 */
const approved = (step, done) => async (item) => {
  const flip = draftNow(item.target && item.target.flipId)
  if (waitingItem(flip, step) !== item.id)
    throw new Error('the draft changed since: not done')
  return done(flip)
}

/** To approve's Approve for each Flips step (pending-api.js executors). */
export function flipsExecutors(t) {
  // Its result is in the draft already: the approval lets the next step take it.
  const release = (flip) => {
    store().updateDraft({
      id: flip.id,
      agentFlip: {...flip.agentFlip, waiting: null},
    })
    return keywordsOf(flip)
  }
  return {
    flipStory: approved('flipStory', release),
    flipPictures: approved('flipPictures', release),
    flipDraft: approved('flipDraft', release),
    flipJudge: approved('flipJudge', (flip) => {
      store().updateDraft({
        id: flip.id,
        agentVerdict: {...flip.agentVerdict, waiting: null},
      })
      return verdictText(flip.agentVerdict, t)
    }),
    // Sent as it is (submitDraft clears the wait); a failure leaves it waiting, with its error.
    flipSubmit: approved('flipSubmit', (flip) => submitDraft(flip.id)),
    flipDelete: approved('flipDelete', (flip) => {
      // Reworked since the judge failed it: not deleted.
      if (!judgedFail(flip))
        throw new Error('the draft changed since the judge failed it')
      store().deleteDraft(flip.id)
      return keywordsOf(flip)
    }),
  }
}

/** To approve's Decline for each Flips step: what the step did is undone (declinedChange). */
export const flipsDecliners = () =>
  Object.fromEntries(
    [
      'flipStory',
      'flipPictures',
      'flipDraft',
      'flipJudge',
      'flipSubmit',
      'flipDelete',
    ].map((step) => [
      step,
      (item) => {
        const flipId = item.target && item.target.flipId
        const flip = store().getFlip(flipId)
        if (flip && waitingItem(flip, step) === item.id) settle(flipId, step)
      },
    ])
  )
