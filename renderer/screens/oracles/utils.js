import {Buffer} from 'buffer'
import dayjs from 'dayjs'
import {assign} from 'xstate'
import urlRegex from 'url-regex-safe'
import {VotingStatus} from '../../shared/types'
import {
  callRpc,
  HASH_IN_MEMPOOL,
  roundToPrecision,
  toLocaleDna,
} from '../../shared/utils/utils'
import {strip} from '../../shared/utils/obj'
import {ContractRpcMode, VotingListFilter} from './types'

export const isVotingStatus =
  (targetStatus) =>
  ({status}) =>
    areSameCaseInsensitive(status, targetStatus)

export const isVotingMiningStatus =
  (targetStatus) =>
  ({status, txHash}) =>
    status === targetStatus && Boolean(txHash)

export const eitherStatus =
  (...statuses) =>
  ({status}) =>
    statuses.some((s) => areSameCaseInsensitive(s, status))

export const setVotingStatus = (status) =>
  assign({
    prevStatus: ({status: currentStatus}) => currentStatus,
    status,
  })

// The votings come from the node's own index (contract_oracleVotings and co.), which answers with the fields of
// the indexer's OracleVotingContract API that used to serve them.
export async function fetchVotings({
  all = false,
  own = false,
  oracle,
  address = oracle,
  limit = 20,
  'states[]': states,
  sortBy,
  continuationToken,
}) {
  const {result, continuationToken: nextContinuationToken} =
    (await callRpc(
      'contract_oracleVotings',
      strip(
        own
          ? {address, limit, continuationToken}
          : {
              oracle,
              all,
              states: states ? states.split(',') : undefined,
              sortBy,
              limit,
              continuationToken,
            }
      )
    )) ?? {}

  return {result, continuationToken: nextContinuationToken}
}

export async function fetchLastOpenVotings({oracle, limit = 11}) {
  const {result} = await fetchVotings({
    oracle,
    'states[]': [VotingStatus.Open].join(','),
    limit,
    sortBy: 'timestamp',
  })

  return result
}

export async function fetchContractBalanceUpdates({
  address,
  contractAddress,
  limit = 50,
}) {
  const {result} =
    (await callRpc('contract_oracleVotingBalanceUpdates', {
      address,
      contract: contractAddress,
      limit,
    })) ?? {}
  return result ?? []
}

export async function fetchVoting({id, contractHash = id, address}) {
  return callRpc('contract_oracleVoting', contractHash, address)
}

// Rejects with `message` when `promise` has not settled after `ms`: a node that does not answer ends as an error
// the page can show instead of a page that waits forever.
export function withTimeout(promise, ms, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

export const NODE_ANSWER_TIMEOUT_MS = 30 * 1000

const TX_POLL_INTERVAL_MS = 10 * 1000
const TX_UNKNOWN_POLLS = 3

/**
 * Asks the node about the transaction every 10 s. Sends `mined` once it is in a block, and `dropped` once the node
 * has not known it for 3 polls in a row (dropped from the mempool; a node restart can also lose it). A poll that
 * fails (the node unreachable for a moment) is repeated, not taken for a drop. Returns the cleanup.
 */
export function pollTransaction(
  txHash,
  send,
  {mined = 'MINED', dropped = 'TX_NULL'} = {}
) {
  let timeoutId
  let unknownPolls = 0

  const fetchStatus = async () => {
    let tx
    try {
      tx = await callRpc('bcn_transaction', txHash)
    } catch {
      timeoutId = setTimeout(fetchStatus, TX_POLL_INTERVAL_MS)
      return
    }
    if (!tx) {
      unknownPolls += 1
      if (unknownPolls >= TX_UNKNOWN_POLLS) {
        send(dropped)
        return
      }
    } else if (tx.blockHash !== HASH_IN_MEMPOOL) {
      send(mined)
      return
    } else {
      unknownPolls = 0
    }
    timeoutId = setTimeout(fetchStatus, TX_POLL_INTERVAL_MS)
  }

  timeoutId = setTimeout(fetchStatus, TX_POLL_INTERVAL_MS)

  return () => {
    clearTimeout(timeoutId)
  }
}

export const createContractCaller =
  ({from, contractHash, gasCost, txFee, amount, broadcastBlock}) =>
  (method, mode = ContractRpcMode.Call, ...args) => {
    const isCalling = mode === ContractRpcMode.Call

    const payload = strip({
      from,
      contract: contractHash,
      method,
      maxFee: isCalling ? contractMaxFee(gasCost, txFee) : null,
      amount: isCalling && method === 'sendVote' ? null : amount,
      broadcastBlock:
        isCalling && method === 'sendVote' ? broadcastBlock : null,
      args: buildDynamicArgs(args),
    })

    return callRpc(
      isCalling ? 'contract_call' : 'contract_estimateCall',
      payload
    )
  }

export const createContractReadonlyCaller =
  ({contractHash}) =>
  (method, format = 'hex', ...args) =>
    callRpc(
      'contract_readonlyCall',
      strip({
        contract: contractHash,
        method,
        format,
        args: buildDynamicArgs(args),
      })
    )

export const createContractDataReader =
  ({contractHash}) =>
  (key, format) =>
    callRpc('contract_readData', contractHash, key, format)

export function objectToHex(obj) {
  return Buffer.from(stringToHex(JSON.stringify(obj)))
}

function stringToHex(str) {
  return Buffer.from(new TextEncoder().encode(str)).toString('hex')
}

export function hexToObject(hex) {
  try {
    return JSON.parse(
      new TextDecoder().decode(Buffer.from(hex.substring(2), 'hex'))
    )
  } catch {
    return {}
  }
}

export function buildContractDeploymentArgs(
  {
    title,
    desc,
    startDate,
    votingDuration,
    publicVotingDuration,
    winnerThreshold = 66,
    quorum,
    committeeSize,
    votingMinPayment = 0,
    options = [],
    ownerFee = 0,
    shouldStartImmediately,
    isFreeVoting,
    isCustomOwnerAddress,
    ownerAddress,
    rewardsFund,
    adCid,
  },
  {from, stake, gasCost, txFee},
  mode = ContractRpcMode.Call
) {
  return strip({
    from,
    codeHash: '0x02',
    amount: stake,
    maxFee:
      mode === ContractRpcMode.Call ? contractMaxFee(gasCost, txFee) : null,
    args: buildDynamicArgs([
      {
        value: `0x${objectToHex({
          title,
          desc,
          options: stripOptions(options),
          adCid,
        })}`,
      },
      {
        value: dayjs(shouldStartImmediately ? Date.now() : startDate).unix(),
        format: 'uint64',
      },
      {value: votingDuration, format: 'uint64'},
      {value: publicVotingDuration, format: 'uint64'},
      {value: winnerThreshold, format: 'byte'},
      {value: quorum, format: 'byte'},
      {value: committeeSize, format: 'uint64'},
      {
        value: isFreeVoting ? 0 : votingMinPayment,
        format: 'dna',
      },
      {value: ownerFee, format: 'byte'},
      {value: rewardsFund, format: 'dna'},
      {value: isCustomOwnerAddress ? ownerAddress : null},
    ]),
  })
}

export function buildDynamicArgs(args = []) {
  return args
    .map(({format = 'hex', value}, index) => ({
      index,
      format,
      value: typeof value !== 'string' ? value?.toString() ?? null : value,
    }))
    .filter(({value = null}) => value !== null)
}

export function contractMaxFee(gasCost, txFee) {
  return Math.ceil((Number(gasCost) + Number(txFee)) * 1.1)
}

export const BLOCK_TIME = 20
const defaultVotingDuration = 4320

export const votingFinishDate = ({
  startDate,
  votingDuration = defaultVotingDuration,
  publicVotingDuration = defaultVotingDuration,
}) =>
  dayjs(startDate)
    .add(votingDuration * BLOCK_TIME, 's')
    .add(publicVotingDuration * BLOCK_TIME, 's')
    .toDate()

export function viewVotingHref(id) {
  return `/oracles/view?id=${id}`
}

export const byContractHash = (a) => (b) =>
  areSameCaseInsensitive(a.contractHash, b.contractHash)

export function areSameCaseInsensitive(a, b) {
  return a?.toUpperCase() === b?.toUpperCase()
}

export function oracleReward({
  balance,
  votesCount,
  quorum,
  committeeSize,
  ownerFee,
}) {
  if ([balance, votesCount, quorum, committeeSize].some((v) => Number.isNaN(v)))
    return undefined

  return (
    (balance * (1 - ownerFee / 100)) /
    Math.max(quorumVotesCount({quorum, committeeSize}), votesCount)
  )
}

export function quorumVotesCount({quorum, committeeSize}) {
  return Math.ceil((committeeSize * quorum) / 100)
}

export function winnerVotesCount({winnerThreshold, votesCount}) {
  return Math.ceil((votesCount * winnerThreshold) / 100)
}

export function hasQuorum({votesCount, quorum, committeeSize}) {
  const requiredVotesCount = quorumVotesCount({quorum, committeeSize})
  return votesCount >= requiredVotesCount
}

export function hasWinner({
  votes = [],
  votesCount,
  winnerThreshold,
  quorum,
  committeeSize,
}) {
  const requiredVotesCountByVotes = winnerVotesCount({
    winnerThreshold,
    votesCount: votes.reduce((prev, cur) => prev + cur.count, 0),
  })

  const didReachQuorum = hasQuorum({votesCount, quorum, committeeSize})

  return (
    didReachQuorum &&
    votes.some(({count}) => count >= requiredVotesCountByVotes)
  )
}

export function votingMinStake(feePerGas) {
  return 3000000 * dnaFeePerGas(feePerGas)
}

export function votingMinBalance(minReward, committeeSize) {
  return roundToPrecision(4, Number(minReward) * committeeSize)
}

function dnaFeePerGas(value) {
  return value * 10 ** -18
}

export function durationPreset(interval, label) {
  const value = blocksPerInterval(interval)

  if (label) return {value, label}

  const [[unit], unitValue] = Object.entries(interval).find(([, v]) => v)

  return {
    value,
    label: `${unitValue}${unit}`,
  }
}

export function blocksPerInterval({
  weeks,
  days = weeks * 7,
  hours = days * 24,
}) {
  return Math.round((hours * 60 * 60) / 20)
}

export function votingStatuses(filter) {
  switch (filter) {
    case VotingListFilter.Todo:
      return [VotingStatus.Pending, VotingStatus.Open]
    case VotingListFilter.Voting:
      return [
        VotingStatus.Voted,
        VotingStatus.Counting,
        VotingStatus.CanBeProlonged,
      ]
    case VotingListFilter.Closed:
      return [VotingStatus.Archived, VotingStatus.Terminated]
    case VotingListFilter.All:
    case VotingListFilter.Own:
      return [
        VotingStatus.Pending,
        VotingStatus.Open,
        VotingStatus.Voted,
        VotingStatus.Counting,
        VotingStatus.CanBeProlonged,
        VotingStatus.Archived,
        VotingStatus.Terminated,
      ]

    default: {
      console.warn(
        typeof filter === 'undefined'
          ? 'You must provide a filter'
          : `Unknown filter: ${filter}`
      )
    }
  }
}

export const humanizeDuration = (duration) =>
  dayjs.duration(duration * BLOCK_TIME, 's').humanize()

export const humanError = (
  error,
  {
    startDate,
    balance,
    // eslint-disable-next-line no-shadow
    minOracleReward,
    committeeSize,
    votingMinPayment,
    ownerDeposit,
  },
  locale = global.locale
) => {
  const dna = toLocaleDna(locale)

  switch (error) {
    case 'no value':
      return 'Invalid parameter when calling smart contract method'
    case 'contract is not in pending state':
      return 'Voting has already started'
    case 'starting is locked':
      return `Cannot start the voting before specific time: ${new Date(
        startDate
      ).toLocaleString()}`
    case 'contract balance is less than minimal oracles reward': {
      const requiredBalance = votingMinBalance(minOracleReward, committeeSize)
      return `Insufficient funds to start the voting. Minimum deposit is required: ${dna(
        requiredBalance
      )}. Current balance: ${dna(balance)}.`
    }
    case 'contract balance is less than minimal deposit': {
      return `Insufficient funds to start the voting. Minimum deposit is required: ${dna(
        ownerDeposit
      )}. Current balance: ${dna(balance)}.`
    }
    case 'sender is not identity':
      return 'Your address cannot vote'
    case 'voting should be prolonged':
      return 'The voting must be prolonged since a new epoch has started'
    case 'contract is not in running state':
      return 'Voting has not started yet'
    case 'sender has voted already':
      return 'Your address has already voted.'
    case 'too late to accept secret vote':
      return 'Cannot vote. Voting is finished.'
    case 'tx amount is less than voting minimal payment':
      return `Cannot vote. Transaction amount is less than the required minimum deposit: ${dna(
        votingMinPayment
      )}`
    case 'invalid proof':
      return 'Your address is not selected for the voting'
    case 'too early to accept open vote':
      return 'Cannot publish the vote yet'
    case 'too late to accept open vote':
      return 'Cannot publish the vote. Voting is finished.'
    case 'wrong vote hash':
      return 'Invalid vote hash'
    case 'not enough votes to finish voting':
      return 'Not enough votes to finish the voting'
    case 'voting can not be prolonged':
      return 'The voting cannot be prolonged'
    case 'voting can not be terminated':
      return 'The voting cannot be terminated'
    case 'insufficient funds':
      return 'Not enough funds to vote'
    default:
      return error
  }
}

export const isAllowedToTerminate = ({estimatedTerminationTime}) =>
  estimatedTerminationTime && dayjs().isAfter(estimatedTerminationTime)

export function stripOptions(options) {
  return options.filter(({value}) => Boolean(value))
}

export function hasValuableOptions(options) {
  return stripOptions(options).length >= 2
}

export function hasLinklessOptions(options) {
  return stripOptions(options).every(({value}) => getUrls(value).length === 0)
}

// A voting's fact is whatever its author put in the contract. Only its text fields are read, and only with the
// types the app writes ({title, desc, options: [{id, value}], adCid}): a fact with other contents shows as an
// untitled voting instead of breaking the page, and cannot stand in for what the node reports (id, status...).
export function votingFact(fact) {
  const decoded = hexToObject(fact)
  const {title, desc, options, adCid} =
    decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded
      : {}
  return {
    title: typeof title === 'string' ? title : '',
    desc: typeof desc === 'string' ? desc : '',
    options: Array.isArray(options)
      ? options.filter(
          (option) =>
            option &&
            typeof option.value === 'string' &&
            ['number', 'string'].includes(typeof option.id)
        )
      : [],
    ...(typeof adCid === 'string' && {adCid}),
  }
}

export const mapVoting = ({
  contractAddress,
  author,
  fact,
  state,
  createTime,
  startTime,
  estimatedVotingFinishTime,
  estimatedPublicVotingFinishTime,
  votingFinishTime,
  publicVotingFinishTime,
  minPayment,
  oracleRewardFund,
  ...voting
}) => ({
  ...voting,
  id: contractAddress,
  contractHash: contractAddress,
  issuer: author,
  status: state,
  createDate: createTime,
  startDate: startTime,
  finishDate: estimatedVotingFinishTime || votingFinishTime,
  finishCountingDate: estimatedPublicVotingFinishTime || publicVotingFinishTime,
  votingMinPayment: minPayment,
  rewardsFund: oracleRewardFund || 0,
  ...votingFact(fact),
})

export function mapVotingStatus(status) {
  if (areSameCaseInsensitive(status, VotingStatus.CanBeProlonged))
    return 'Prolongation'
  if (areSameCaseInsensitive(status, VotingStatus.Voted)) return 'Voting'
  return status
}

// Whether the node gave an amount (a finished voting's totalReward is missing when the node did not see it end).
export const isKnownAmount = (value) =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  Number.isFinite(Number(value))

export const effectiveBalance = ({balance, ownerFee}) =>
  roundToPrecision(4, balance * (1 - (ownerFee || 0) / 100))

export function getUrls(text) {
  return text.match(urlRegex()) || []
}

export const sumAccountableVotes = (votes) =>
  votes?.reduce((agg, curr) => agg + (curr?.count ?? 0), 0) ?? 0

export const minOwnerDeposit = (networkSize, commiteeSize) =>
  Math.min(
    5000,
    (Math.ceil((5000 / networkSize) * 10000) / 10000) * commiteeSize
  )
