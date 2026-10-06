// The History page: an address's history as its own node records it (dna_identityHistory), shaped for the tabs.

export const HistoryTab = {
  Ceremonies: 'ceremonies',
  Transactions: 'transactions',
  Mining: 'mining',
}

export function parseHistoryTab(value) {
  return Object.values(HistoryTab).includes(value)
    ? value
    : HistoryTab.Ceremonies
}

// Amounts arrive as decimal strings (iDNA).
export function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const validatedStates = ['Newbie', 'Verified', 'Human']

export function isValidatedState(state) {
  return validatedStates.includes(state)
}

export const RewardKinds = [
  'staking',
  'candidate',
  'flips',
  'extraFlips',
  'invitations',
  'invitee',
  'reports',
  'validation',
]

export function earnedRewards(summary) {
  if (!summary?.rewards) return 0
  return RewardKinds.reduce(
    (sum, kind) => sum + toNumber(summary.rewards[kind]?.earned),
    0
  )
}

export function missedRewards(summary) {
  if (!summary?.rewards) return 0
  return RewardKinds.reduce(
    (sum, kind) => sum + toNumber(summary.rewards[kind]?.missed),
    0
  )
}

export const CeremonyResult = {
  Validated: 'validated',
  NotValidated: 'notValidated',
  // The address had no identity in the ceremony.
  Absent: 'absent',
  // Nobody was validated: identities kept their states.
  Failed: 'failed',
  Unknown: 'unknown',
}

// The ceremony's outcome for the address: from the node's validation summary when it recorded one, else from the
// validator flag the ceremony block wrote.
export function ceremonyResult({summary, validated}) {
  if (summary) {
    if (summary.validationFailed) return {kind: CeremonyResult.Failed}
    if (!summary.participated && summary.state === 'Undefined')
      return {kind: CeremonyResult.Absent}
    return {
      kind: isValidatedState(summary.state)
        ? CeremonyResult.Validated
        : CeremonyResult.NotValidated,
      prevState: summary.prevState,
      state: summary.state,
    }
  }
  if (validated === true) return {kind: CeremonyResult.Validated}
  if (validated === false) return {kind: CeremonyResult.NotValidated}
  return {kind: CeremonyResult.Unknown}
}

function hasActivity(row) {
  return (
    row.result.kind === CeremonyResult.Validated ||
    Boolean(row.summary?.participated) ||
    Boolean(row.score) ||
    row.flipsSubmitted > 0 ||
    row.shortAnswers ||
    row.longAnswers
  )
}

// One row per past ceremony the node knows, newest first, starting at the first one where the address shows any
// activity (older ceremonies say nothing about it).
export function ceremonyRows(history) {
  if (!history?.epochs) return []
  const scores = new Map(
    (history.scores ?? [])
      .filter(({epoch}) => epoch !== null && epoch !== undefined)
      .map((score) => [score.epoch, score])
  )
  const rows = history.epochs
    .filter(
      ({epoch, ceremony, summary}) =>
        epoch < history.epoch && (ceremony || summary)
    )
    .map((item) => {
      const {epoch, ceremony, summary, transactions} = item
      let score = null
      if (summary?.participated && !summary.missed && summary.shortAnswers)
        score = {
          points: summary.shortAnswers.point,
          flips: summary.shortAnswers.flipsCount,
        }
      else if (scores.has(epoch))
        score = {
          points: scores.get(epoch).shortPoints,
          flips: scores.get(epoch).shortFlips,
        }
      return {
        epoch,
        time: ceremony?.time,
        height: ceremony?.height,
        summary,
        result: ceremonyResult(item),
        score,
        flipsSubmitted: transactions?.flips ?? 0,
        shortAnswers: Boolean(transactions?.shortAnswers),
        longAnswers: Boolean(transactions?.longAnswers),
        earned: earnedRewards(summary),
        missed: missedRewards(summary),
      }
    })
  let last = rows.length - 1
  while (last >= 0 && !hasActivity(rows[last])) last -= 1
  return rows.slice(0, last + 1)
}

// One row per epoch with recorded mining, newest first, and the totals.
export function miningRows(history) {
  const rows = (history?.epochs ?? [])
    .filter(({mining}) => mining)
    .map(({epoch, mining}) => {
      const proposerReward = toNumber(mining.proposerReward)
      const committeeReward = toNumber(mining.committeeReward)
      const penaltyBurnt = toNumber(mining.penaltyBurnt)
      return {
        epoch,
        proposedBlocks: mining.proposedBlocks,
        proposerReward,
        committeeBlocks: mining.committeeBlocks,
        committeeReward,
        penaltyBurnt,
        total: proposerReward + committeeReward - penaltyBurnt,
      }
    })
  const totals = rows.reduce(
    (sum, row) => ({
      proposedBlocks: sum.proposedBlocks + row.proposedBlocks,
      committeeBlocks: sum.committeeBlocks + row.committeeBlocks,
      total: sum.total + row.total,
    }),
    {proposedBlocks: 0, committeeBlocks: 0, total: 0}
  )
  return {rows, totals}
}

const txTypeNames = {
  send: 'Transfer',
  activation: 'Invitation activated',
  invite: 'Invitation issued',
  killInvitee: 'Invitation terminated',
  kill: 'Identity terminated',
  killDelegator: 'Delegator removed',
  submitFlip: 'Flip submitted',
  deleteFlip: 'Flip deleted',
  submitAnswersHash: 'Short answers (hash)',
  submitShortAnswers: 'Short answers',
  submitLongAnswers: 'Long answers',
  evidence: 'Validation evidence',
  online: 'Mining status',
  changeProfile: 'Profile changed',
  deployContract: 'Contract deployed',
  callContract: 'Contract call',
  terminateContract: 'Contract terminated',
  delegate: 'Delegation',
  undelegate: 'Undelegation',
  replenishStake: 'Stake replenished',
  burn: 'Burn',
  storeToIpfs: 'Stored to IPFS',
  changeGodAddress: 'God address changed',
}

// The English label of a transaction type (the page passes it through t()).
export function txTypeName({type, payload}) {
  if (type === 'online')
    return payload === '0x' ? 'Mining status Off' : 'Mining status On'
  return txTypeNames[type] ?? type
}

// Amount seen from the address: negative when it sent the coins.
export function signedAmount(tx, address) {
  const amount = toNumber(tx.amount)
  if (!amount) return 0
  return tx.from?.toLowerCase() === address?.toLowerCase() ? -amount : amount
}

export function counterParty(tx, address) {
  return tx.from?.toLowerCase() === address?.toLowerCase() ? tx.to : tx.from
}
