import {AnswerType, RelevanceType} from '../../shared/types'
import {shuffle} from '../../shared/utils/arr'
import {availableReportsNumber, readyNotFetchedFlip} from './utils'

// The practice validation: the validation screens with the sample validation of the Idena web app (6 short-session
// and 9 long-session flips with their right answers, `public/static/practice-flips.json`, the file the phone app
// bundles). Nothing goes to the node and nothing is saved.

/** The short session lasts 2 minutes (config.ShortSession). */
export const PRACTICE_SHORT_SESSION_DURATION = 120

/** The long session lasts one minute per flip (ValidationConfig.GetLongSessionDuration). */
export const PRACTICE_LONG_SESSION_DURATION_PER_FLIP = 60

let sampleFlips

/** The sample flips, read once. */
export async function loadPracticeFlips() {
  if (!sampleFlips) {
    sampleFlips = fetch('/static/practice-flips.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .catch((error) => {
        sampleFlips = null
        throw error
      })
  }
  return sampleFlips
}

/**
 * A new practice from the sample flips: each session in a new order, and each flip with its two stories on sides
 * picked at random.
 */
export function createPractice({short, long}, random = Math.random) {
  const practiceFlip = ({
    hash,
    images,
    orders: [first, second],
    answer,
    reportReason,
    keywords,
  }) => {
    const firstIsRight = answer === AnswerType.Left
    const swap = random() < 0.5
    return {
      hash,
      images,
      orders: swap ? [second, first] : [first, second],
      answer: firstIsRight !== swap ? AnswerType.Left : AnswerType.Right,
      reportReason,
      words: keywords.map(({name, desc}, idx) => ({
        id: `${hash}-${idx}`,
        name,
        desc,
      })),
    }
  }
  return {
    short: shuffle(short.map(practiceFlip)),
    long: shuffle(long.map(practiceFlip)),
  }
}

function imageUrl(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const type = bytes[0] === 0xff ? 'image/jpeg' : 'image/png'
  return URL.createObjectURL(new Blob([bytes], {type}))
}

function sendFlips(practiceFlips, flips, cb) {
  flips.filter(readyNotFetchedFlip).forEach(({hash}) => {
    const flip = practiceFlips.find((x) => x.hash === hash)
    if (flip)
      cb({
        type: 'FLIP',
        flip: {
          hash,
          images: flip.images.map(imageUrl),
          orders: flip.orders,
          fetched: true,
          decoded: true,
        },
      })
  })
  return Promise.resolve()
}

/** The validation machine's services for a practice: the sample flips, no translations. */
export function practiceServices(practice) {
  const hashes = (flips) =>
    Promise.resolve(flips.map(({hash}) => ({hash, ready: true})))
  return {
    fetchShortHashes: () => hashes(practice.short),
    fetchShortFlips:
      ({shortFlips}) =>
      (cb) =>
        sendFlips(practice.short, shortFlips, cb),
    fetchLongHashes: () => hashes(practice.long),
    fetchLongFlips:
      ({longFlips}) =>
      (cb) =>
        sendFlips(practice.long, longFlips, cb),
    fetchTranslations: () => Promise.resolve([]),
  }
}

/** The validation machine's node calls for a practice: the sample keywords, the answers sent nowhere. */
export function practiceNodeCalls(practice) {
  return {
    submitShortAnswers: () => Promise.resolve(),
    submitLongAnswers: () => Promise.resolve(null),
    fetchKeywords: () =>
      Promise.resolve(practice.long.map(({hash, words}) => ({hash, words}))),
  }
}

/** The story the answer picked: right, wrong or none. */
function story(practiceFlip, flip) {
  if (!flip?.option) return 'none'
  return flip.option === practiceFlip.answer ? 'right' : 'wrong'
}

/** How the practice went, from the machine's last context. */
export function practiceResults(
  practice,
  {shortFlips = [], longFlips = [], bestFlipHashes = {}}
) {
  const byHash = (flips) => (hash) => flips.find((x) => x.hash === hash)
  const shortFlip = byHash(shortFlips)
  const longFlip = byHash(longFlips)

  // Flips to report do not count for the stories, as in the validation.
  const solvable = practice.long.filter(({reportReason}) => !reportReason)
  const toReport = practice.long.filter(({reportReason}) => reportReason)

  return {
    short: {
      right: practice.short.filter(
        (x) => story(x, shortFlip(x.hash)) === 'right'
      ).length,
      total: practice.short.length,
    },
    long: {
      right: solvable.filter((x) => story(x, longFlip(x.hash)) === 'right')
        .length,
      total: solvable.length,
    },
    reports: {
      reported: toReport.filter(
        (x) => longFlip(x.hash)?.relevance === RelevanceType.Irrelevant
      ).length,
      total: toReport.length,
      allowed: availableReportsNumber(practice.long),
    },
    longFlips: practice.long.map((x) => {
      const relevance = longFlip(x.hash)?.relevance
      let check
      if (x.reportReason)
        check =
          relevance === RelevanceType.Irrelevant ? 'reported' : 'shouldReport'
      else if (relevance === RelevanceType.Irrelevant) check = 'shouldApprove'
      else if (relevance === RelevanceType.Relevant) check = 'approved'
      else check = 'notChecked'
      return {
        hash: x.hash,
        keywords: x.words.map(({name}) => name),
        story: x.reportReason ? null : story(x, longFlip(x.hash)),
        check,
        reportReason: x.reportReason,
        isBest: !!bestFlipHashes[x.hash],
      }
    }),
  }
}
