/* eslint-disable no-use-before-define */
import i18n from '../../i18n'
import {Profile} from '../../shared/models/profile'
import {VotingStatus} from '../../shared/types'
import {dexieDb} from '../../shared/utils/dexieDb'
import {
  areSameCaseInsensitive,
  callRpc,
  HASH_IN_MEMPOOL,
  prependHex,
} from '../../shared/utils/utils'
import {isValidUrl} from '../dna/utils'
import {AdStatus, AdVotingOption, AdVotingOptionId} from './types'
import {resizeImageToArrayBuffer} from '../../shared/utils/image-canvas'
import {minOwnerDeposit, votingFact} from '../oracles/utils'

export const OS = {
  Windows: 'windows',
  macOS: 'macos',
  Linux: 'linux',
  iOS: 'ios',
  Android: 'android',
}

export function currentOs() {
  switch (true) {
    case /Android/.test(navigator.userAgent):
      return OS.Android
    case /iPhone|iPad|iPod/.test(navigator.userAgent):
      return OS.iOS
    case /Win/.test(navigator.userAgent):
      return OS.Windows
    case /Mac/.test(navigator.userAgent):
      return OS.macOS
    case /Linux/.test(navigator.userAgent):
      return OS.Linux
    default:
      return null
  }
}

export const isTargetedAd = (targetA, targetB) =>
  compareNullish(targetA.language, targetB.language, areSameCaseInsensitive) &&
  compareNullish(targetA.os, targetB.os, areSameCaseInsensitive) &&
  compareNullish(
    targetA.age,
    targetB.age,
    (ageA, ageB) => Number(ageB) >= Number(ageA)
  ) &&
  compareNullish(
    targetA.stake,
    targetB.stake,
    (stakeA, stakeB) => Number(stakeB) >= Number(stakeA)
  )

export const areCompetingAds = (targetA, targetB) =>
  compareNullish(targetA.language, targetB.language, areSameCaseInsensitive) ||
  compareNullish(targetA.os, targetB.os, areSameCaseInsensitive) ||
  compareNullish(
    targetA.age,
    targetB.age,
    (ageA, ageB) => Number(ageB) >= Number(ageA)
  ) ||
  compareNullish(
    targetA.stake,
    targetB.stake,
    (stakeA, stakeB) => Number(stakeB) >= Number(stakeA)
  )

export const compareNullish = (field, targetField, condition) =>
  field ? condition(field, targetField) : true

export const selectProfileHash = (data) => data.profileHash

export async function getAdVoting(address) {
  const persistedAdVoting = await dexieDb
    .table('adVotings')
    .get(address)
    .catch(() => null)

  if (persistedAdVoting) {
    return persistedAdVoting
  }

  const voting = await fetchAdVoting(address)

  if (isFinalVoting(voting) && voting?.isFetched) {
    await dexieDb.table('adVotings').put({...voting, address})
  }

  return voting
}

const findContractData = (batchData, key) =>
  batchData.find((x) => x.key === key)

async function fetchAdVoting(address) {
  const batchData = await callRpc('contract_batchReadData', address, [
    {key: 'state', format: 'byte'},
    {key: 'fact', format: 'hex'},
    {key: 'result', format: 'byte'},
  ])

  try {
    const {value: state, error: stateError} = findContractData(
      batchData,
      'state'
    )

    const fact = findContractData(batchData, 'fact')
    const result = findContractData(batchData, 'result')

    if (fact.error) {
      throw new Error('Voting does not exist')
    }
    // A voting gets its result when it finishes with a winner: none while it waits for its start or runs, or
    // after it ended without a winner.
    if (result.error && result.error !== 'data is nil') {
      throw new Error(result.error)
    }

    if (Boolean(stateError) && stateError !== 'data is nil')
      throw new Error(stateError)

    const status =
      stateError === 'data is nil'
        ? VotingStatus.Terminated
        : mapToVotingStatus(state)

    // The fact gives the texts only; status and result are the contract's.
    return {
      ...votingFact(fact.value),
      status,
      result: result.error ? undefined : result.value,
      isFetched: true,
    }
  } catch (e) {
    console.error(e, address)
  }
}

export const createContractDataReader = (address) => (key, format) =>
  callRpc('contract_readData', address, key, format)

const mapToVotingStatus = (status) => {
  switch (status) {
    case 0:
      return VotingStatus.Pending
    case 1:
      return VotingStatus.Open
    case 2:
      return VotingStatus.Archived
    default:
      return status
  }
}

const buildAdReviewVotingOption = (option) => ({
  id: AdVotingOptionId[option],
  value: option,
})

export const adVotingDefaults = {
  title: 'Is this ad appropriate?',
  votingDuration: !global.isDev ? 4320 : 10,
  publicVotingDuration: !global.isDev ? 4320 : 10,
  winnerThreshold: 51,
  quorum: 1,
  committeeSize: 300,
  ownerFee: 0,
  shouldStartImmediately: true,
  isFreeVoting: true,
  options: [
    buildAdReviewVotingOption(AdVotingOption.Approve),
    buildAdReviewVotingOption(AdVotingOption.Reject),
  ],
}

export const buildAdReviewVoting = ({title, adCid}) => ({
  ...adVotingDefaults,
  desc: title,
  adCid,
})

/**
 * The owner deposit an ad review needs: the contract caps the committee at the network size and asks the minimum
 * oracle reward (5000 / network size) for each seat, so 5000 iDNA below 300 identities. It is refunded when the
 * voting ends; anything sent above it was paid to the oracles (13,158 iDNA instead of 5,000 at 114 identities).
 */
export const adReviewDeposit = (networkSize) =>
  minOwnerDeposit(networkSize, adVotingDefaults.committeeSize)

/**
 * Whether a voting has the committee of an ad review: the contract stores min(300, network size at deploy), so
 * 300, or a smaller network with the 5000 iDNA deposit of a full committee. A voting deployed with a small
 * committee (a few chosen oracles) has a smaller deposit and does not pass.
 */
export function isAdReviewCommittee({committeeSize, ownerDeposit}) {
  const size = Number(committeeSize)
  if (size === adVotingDefaults.committeeSize) return true
  return (
    size > 0 &&
    size < adVotingDefaults.committeeSize &&
    Number(ownerDeposit) >= 5000 - 0.01
  )
}

/**
 * The ads in the address's profile, none when it has no profile. A failed read throws: publishing writes the
 * whole list back, and an empty list read by mistake removed the campaigns already in the profile.
 */
export async function fetchProfileAds(address) {
  try {
    const {profileHash} = await callRpc('dna_identity', address)

    return profileHash
      ? Profile.fromHex(await callRpc('ipfs_get', profileHash)).ads ?? []
      : []
  } catch (error) {
    console.error('Error fetching ads for identity', address, error?.message)
    throw new Error(
      i18n.t(
        'Cannot read the campaigns already in your profile. Nothing was sent, try again later.'
      )
    )
  }
}

/**
 * A saved ad's status from its review voting (`voting`: the contract's, undefined when the contract holds no
 * voting) and the status saved with it. A voting deployed but never started (its start failed) is no review:
 * the ad is a draft again, `reviewNotStarted` (the review can be started on that contract, its stake is paid).
 * A "reviewing" ad whose contract holds no voting (the deployment never got into a block, or a voting never
 * started was terminated) is a draft again.
 */
export function adReviewStatus(savedStatus, voting) {
  if (!voting) {
    return {
      status: savedStatus === AdStatus.Reviewing ? AdStatus.Draft : savedStatus,
      reviewNotStarted: false,
    }
  }
  if (voting.status === VotingStatus.Pending) {
    return {status: AdStatus.Draft, reviewNotStarted: true}
  }
  // A voting that ended on anything but Approve (Reject, no winner) did not approve the ad.
  return {
    status:
      // eslint-disable-next-line no-nested-ternary
      isApprovedVoting(voting)
        ? AdStatus.Approved
        : isFinalVoting(voting)
        ? AdStatus.Rejected
        : AdStatus.Reviewing,
    reviewNotStarted: false,
  }
}

export const isApprovedVoting = (voting) =>
  isFinalVoting(voting) &&
  isApprovedAd(voting) &&
  voting.title === adVotingDefaults.title

export const isRejectedVoting = (voting) =>
  isFinalVoting(voting) && isRejectedAd(voting)

const isFinalVoting = (voting) =>
  [VotingStatus.Archived, VotingStatus.Terminated].includes(voting?.status)

// The option the voting ended on. Ad votings saved by older versions can hold options that are not a list.
const resultOption = (voting) =>
  (Array.isArray(voting?.options) ? voting.options : []).find(
    (option) => option?.id === voting?.result
  )

const isApprovedAd = (voting) =>
  isValidAdOption(resultOption(voting), AdVotingOption.Approve)

const isRejectedAd = (voting) =>
  isValidAdOption(resultOption(voting), AdVotingOption.Reject)

export const isValidAdOption = (option, targetValue) =>
  option?.id === AdVotingOptionId[targetValue] && option?.value === targetValue

export const adImageThumbSrc = (ad) =>
  typeof ad.thumb === 'string'
    ? ad.thumb
    : ad.thumb && URL.createObjectURL(ad.thumb)

export async function compressAdImage(
  // eslint-disable-next-line no-shadow
  bytes,
  {width = 80, height = 80, type} = {width: 80, height: 80, type: 'image/jpeg'}
) {
  return resizeImageToArrayBuffer(bytes, {
    width,
    height,
    type,
    quality: type === 'image/png' ? 0.92 : 0.6,
    exact: false,
  })
}

export function validateAd(ad) {
  return {
    title: validateAdTitle(ad.title),
    desc: validateAdDesc(ad.desc),
    url: validateAdUrl(ad.url),
    thumb: validateAdThumb(ad.thumb),
    media: validateAdMedia(ad.media),
  }
}

function validateAdTitle(title) {
  if (typeof title !== 'string' || title.trim().length < 1) {
    return i18n.t('Title cannot be empty')
  }

  if (title.trim().length > 40) {
    return i18n.t('Title should be less than 40 characters long')
  }
}

function validateAdDesc(desc) {
  if (typeof desc !== 'string' || desc.trim().length < 1) {
    return i18n.t('Description cannot be empty')
  }

  if (desc.trim().length > 70) {
    return i18n.t('Description should be less than 70 characters long')
  }
}

function validateAdUrl(url) {
  if (typeof url !== 'string' || !isValidUrl(url)) {
    return i18n.t('URL must start with http, https or dna')
  }
}

function validateAdThumb(thumb) {
  if (!isValidImage(thumb)) {
    return i18n.t('Ad thumbnail cannot be empty')
  }

  if (isExceededImageSize(thumb)) {
    return i18n.t('Ad thumbnail should be less than 1MB')
  }
}

function validateAdMedia(media) {
  if (!isValidImage(media)) {
    return i18n.t('Ad media cannot be empty')
  }

  if (isExceededImageSize(media)) {
    return i18n.t('Ad media should be less than 1MB')
  }
}

export function isValidImage(image) {
  if (typeof window !== 'undefined') {
    return image instanceof File && image.size > 0
  }

  return false
}

function isExceededImageSize(image) {
  return image.size > 1024 * 1024
}

export const adFallbackSrc = '/static/body-medium-pic-icn.svg'

export const isMiningTx = (txData) =>
  (txData?.blockHash ?? HASH_IN_MEMPOOL) === HASH_IN_MEMPOOL

export const isMinedTx = (txData) =>
  (txData?.blockHash ?? HASH_IN_MEMPOOL) !== HASH_IN_MEMPOOL

export async function sendTx(params) {
  return callRpc('dna_sendTransaction', params)
}

export async function estimateTx(params) {
  return callRpc('bcn_estimateTx', params)
}

export async function sendToIpfs(hex) {
  const cid = await callRpc('ipfs_add', prependHex(hex), true)

  const hash = await callRpc('dna_storeToIpfs', {cid})

  return {
    cid,
    hash,
  }
}

export const validateAdVoting = ({ad, voting}) => {
  if (global.isDev) return true

  if (ad?.votingParams) {
    const areSameVotingParams =
      ['votingDuration', 'publicVotingDuration', 'quorum'].every(
        (prop) =>
          ad.votingParams[prop] === voting[prop] &&
          ad.votingParams[prop] === adVotingDefaults[prop] &&
          voting[prop] === adVotingDefaults[prop]
      ) &&
      // The ad asked for 300 oracles; on chain the committee is min(300, network size).
      ad.votingParams.committeeSize === adVotingDefaults.committeeSize &&
      isAdReviewCommittee(voting)

    const [maybeApproveOption, maybeRejectOption] = voting.options

    const areValidOptions =
      isValidAdOption(maybeApproveOption, AdVotingOption.Approve) &&
      isValidAdOption(maybeRejectOption, AdVotingOption.Reject)

    return areSameVotingParams && areValidOptions
  }

  return false
}

export function calculateTotalAdScore({target, burnAmount}) {
  return burnAmount * calculateTargetScore(target)
}

export function calculateTargetScore(target) {
  return (
    calculateTargetParamWeight(target?.language, 22) *
    calculateTargetParamWeight(target?.os, 5)
  )
}

export const calculateTargetParamWeight = (param, weight) =>
  param ? weight : 1
