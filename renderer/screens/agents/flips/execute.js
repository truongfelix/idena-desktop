import {nanoid} from 'nanoid'
import {CID} from 'multiformats'
import {FlipType, TxType} from '../../../shared/types'
import models from '../../../shared/models/proto/models_pb'
import {callRpc, loadKeyword} from '../../../shared/utils/utils'
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
import {rewrittenDraft} from './run'

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
  // A draft of four story pictures has no nonsense picture to make (B-283).
  if (flip.adversarialImageId === -1) return []
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

const DELETE_FLIP_TX = TxType.DeleteFlipTx

/** The payload of a flip's deletion: idena-go's DeleteFlipAttachment, the flip's CID bytes. */
export function deletePayload(hash) {
  const attachment = new models.ProtoDeleteFlipAttachment()
  attachment.setCid(CID.parse(hash).bytes)
  const hex = (n) => n.toString(16).padStart(2, '0')
  return `0x${Array.from(attachment.serializeBinary(), hex).join('')}`
}

/** The node's call (callRpc: its result, or it throws the node's error). */
const rpc = (method, params) => callRpc(method, ...params)

/**
 * The most a sent flip's deletion may cost, in iDNA (B-277): the node's dry run of the transaction (its fee depends on
 * its size only), twice over as the other actions' max fee. {from, payload, maxFee}.
 */
export async function deleteCost(flip, call = rpc) {
  const from = await call('dna_getCoinbaseAddr', [])
  const payload = deletePayload(flip.hash)
  const estimate = await call('bcn_estimateTx', [
    {type: DELETE_FLIP_TX, from, payload},
  ])
  const fee = Number(estimate ? estimate.txFee : NaN)
  if (!(fee > 0)) throw new Error('the fee of the deletion is not known')
  return {from, payload, maxFee: Math.ceil(fee * 2 * 1e6) / 1e6}
}

/**
 * Deletes the sent flip the judge failed, as it is, within `maxFee` (deleteCost): the transaction sent, the flip marked
 * as being deleted (the Flips list follows it until mined).
 */
async function deleteSent(flipId, cost, sentTx, call = rpc) {
  const read = () => {
    const now = store().getFlip(flipId)
    if (!now || now.type !== FlipType.Published)
      throw new Error('the flip is not a sent flip any more')
    // Sent again since (the person deleted it, then sent it once more): another sending, not the one judged.
    if (sentTx && now.txHash !== sentTx)
      throw new Error('the flip was sent again since')
    if (now.agentSent && now.agentSent.sending)
      throw new Error('its deletion is being sent already')
    if (!judgedFail(now))
      throw new Error('the flip changed since the judge failed it')
    return now
  }
  read()
  const {from, payload, maxFee} =
    cost || (await deleteCost(store().getFlip(flipId), call))
  // Read again after the estimate, and marked before sending: a second run (another agent) never sends it twice.
  const flip = read()
  store().updateDraft({
    id: flip.id,
    agentSent: {...(flip.agentSent || {}), sending: true},
  })
  let txHash
  try {
    txHash = await call('dna_sendTransaction', [
      {type: DELETE_FLIP_TX, from, payload, maxFee},
    ])
  } catch (error) {
    store().updateDraft({
      id: flip.id,
      agentSent: {...(flip.agentSent || {}), sending: false},
    })
    throw error
  }
  try {
    store().updateDraft({
      id: flip.id,
      txHash,
      type: FlipType.Deleting,
      agentSent: {...(flip.agentSent || {}), waiting: null, sending: false},
    })
  } catch (error) {
    // Sent: its count and cost stay (the flip stays marked as being sent, never sent twice).
    const sent = error instanceof Error ? error : new Error(String(error))
    sent.sent = true
    throw sent
  }
  return txHash
}

/** A declined step settled on the draft (declinedChange); nothing when the draft is gone. */
function settle(flipId, step) {
  const flip = store().getFlip(flipId)
  // A sent flip too (B-277): the judge's verdict on it, its deletion.
  if (!flip || ![FlipType.Draft, FlipType.Published].includes(flip.type)) return
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
    deleteCost: (flip) => deleteCost(flip),
    deleteSent: (flipId, cost, sentTx) => deleteSent(flipId, cost, sentTx),
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
    // A new draft's story; or a new story for a draft the judge failed (B-284), written into it now.
    flipStory: approved('flipStory', (flip) => {
      const {proposed} = flip.agentFlip
      if (!proposed) return release(flip)
      if (!judgedFail(flip))
        throw new Error('the draft changed since the judge failed it')
      store().updateDraft(
        rewrittenDraft(flip, {
          ...proposed,
          at: new Date().toISOString(),
          random: Math.random,
        })
      )
      return keywordsOf(flip)
    }),
    flipPictures: approved('flipPictures', release),
    flipDraft: approved('flipDraft', release),
    // A draft's verdict, or a sent flip's (B-277).
    flipJudge: async (item) => {
      const flip = store().getFlip(item.target && item.target.flipId)
      if (!flip || ![FlipType.Draft, FlipType.Published].includes(flip.type))
        throw new Error('the flip is gone')
      if (waitingItem(flip, 'flipJudge') !== item.id)
        throw new Error('the draft changed since: not done')
      store().updateDraft({
        id: flip.id,
        agentVerdict: {...flip.agentVerdict, waiting: null},
      })
      return verdictText(flip.agentVerdict, t)
    },
    // Sent as it is (submitDraft clears the wait); a failure leaves it waiting, with its error.
    flipSubmit: approved('flipSubmit', (flip) => submitDraft(flip.id)),
    // A sent flip (B-277), as it is when approved: its fee estimated again.
    flipDeleteSent: async (item) => {
      const flipId = item.target && item.target.flipId
      const flip = store().getFlip(flipId)
      if (!flip || waitingItem(flip, 'flipDeleteSent') !== item.id)
        throw new Error('the flip changed since: not done')
      return deleteSent(flipId, null, item.target.txHash || null)
    },
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
      'flipDeleteSent',
    ].map((step) => [
      step,
      (item) => {
        const flipId = item.target && item.target.flipId
        const flip = store().getFlip(flipId)
        if (flip && waitingItem(flip, step) === item.id) settle(flipId, step)
      },
    ])
  )
