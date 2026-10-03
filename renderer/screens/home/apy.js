/*
 * The yearly return of staking and mining, from the node's own data and its reward rules (consensus v12):
 * blockchain/rewards.go (staking), blockchain/blockchain.go applyBlockRewards, rewardFinalCommittee,
 * prepareBlockRewardCtx and GetCommitteeSize (mining), config/consensus.go. The flip and invitation rewards
 * are left out: they depend on the last epoch's results, which the node does not keep. The phone app
 * computes it the same way (idena-mobile Apy.kt).
 */

/** Consensus values the rewards use (config/consensus.go, unchanged up to v12). */
export const RewardRules = {
  // Minted per block: BlockReward + FinalCommitteeReward (iDNA).
  BLOCK_REWARD: 1,
  FINAL_COMMITTEE_REWARD: 5,
  // Share of the epoch's validation reward (6 iDNA per block of the epoch) paid for staking.
  STAKING_REWARD_PERCENT: 0.18,
  FINAL_COMMITTEE_PERCENT: 0.7,
  MAX_COMMITTEE_SIZE: 100,
  BLOCK_SECONDS: 20,
}

const VALIDATED_STATES = new Set(['Newbie', 'Verified', 'Human'])

// The god address shares the staking reward too (addSuccessfulValidationReward).
const GOD_ADDRESS = '0x4d60dc6a2cba8c3ef1ba5e1eba5c12c54cee6b61'

/** Reward weight of a stake in iDNA: stake^0.9 (stakeWeight, calculateStakeWeight). */
export function stakeWeight(stake) {
  return stake > 0 ? stake ** 0.9 : 0
}

/** The final committee size for `validators` online validators (GetCommitteeSize, final). */
export function finalCommitteeSize(validators) {
  return validators <= 8
    ? validators
    : Math.min(
        Math.round(validators * RewardRules.FINAL_COMMITTEE_PERCENT),
        RewardRules.MAX_COMMITTEE_SIZE
      )
}

/**
 * One block's reward (iDNA) for a validator of `weight` that is the `proposer`, a committee `member`, or
 * both; the other places go to validators of `averageWeight`. The 6 iDNA are shared by weight, the
 * proposer's weight counting committee x BlockReward / FinalCommitteeReward times: with equal stakes the
 * proposer gets the BlockReward and each member FinalCommitteeReward / committee.
 */
export function blockReward(
  weight,
  proposer,
  member,
  committee,
  averageWeight
) {
  const coef =
    (committee * RewardRules.BLOCK_REWARD) / RewardRules.FINAL_COMMITTEE_REWARD
  const mine = (proposer ? weight * coef : 0) + (member ? weight : 0)
  const others =
    (proposer ? 0 : averageWeight * coef) +
    (member ? committee - 1 : committee) * averageWeight
  return (
    ((RewardRules.BLOCK_REWARD + RewardRules.FINAL_COMMITTEE_REWARD) * mine) /
    (mine + others)
  )
}

/**
 * The expected mining reward per block (iDNA) for a validator of weight `weight` among `validators` online
 * validators of average weight `averageWeight`. A block mints 6 iDNA shared by weight between the proposer
 * and the final committee members; any validator proposes with the same chance, the committee takes
 * finalCommitteeSize of them.
 */
export function miningRewardPerBlock(weight, validators, averageWeight) {
  if (validators <= 0 || weight <= 0) return 0
  const committee = finalCommitteeSize(validators)
  const pProposer = 1 / validators
  const pCommittee = committee / validators
  return (
    pProposer *
      (1 - pCommittee) *
      blockReward(weight, true, false, committee, averageWeight) +
    (1 - pProposer) *
      pCommittee *
      blockReward(weight, false, true, committee, averageWeight) +
    pProposer *
      pCommittee *
      blockReward(weight, true, true, committee, averageWeight)
  )
}

/**
 * The staking and mining rewards of one epoch and the APY they make (a fraction) for an identity with
 * `stake` iDNA that validates and mines itself, or null without the network data (networkRewardsOf).
 */
export function apy(stake, net) {
  if (
    !net ||
    !(stake > 0) ||
    !(net.epochDays > 0) ||
    !(net.totalStakingWeight > 0)
  ) {
    return null
  }
  const weight = stakeWeight(stake)
  const blocks = (net.epochDays * 86400) / RewardRules.BLOCK_SECONDS
  const staking =
    ((RewardRules.BLOCK_REWARD + RewardRules.FINAL_COMMITTEE_REWARD) *
      blocks *
      RewardRules.STAKING_REWARD_PERCENT *
      weight) /
    net.totalStakingWeight
  const mining =
    blocks *
    net.proposedBlockShare *
    miningRewardPerBlock(weight, net.validators, net.averageValidatorWeight)
  return {
    stakingPerEpoch: staking,
    miningPerEpoch: mining,
    yearly: (((staking + mining) / stake) * 365) / net.epochDays,
  }
}

/**
 * What the APY needs from the network:
 * - `identities`: dna_identities (state, address, stake, online, delegatee);
 * - `onlinePools`: the delegatee addresses (lowercase) that are online;
 * - `godStake`: the god address's stake, counted when it is not among the identities;
 * - `epochStart` (s) and `nextValidation` (RFC 3339): the current epoch;
 * - `recentBlocks`: the last blocks (isEmpty), for the share of blocks with a proposal.
 */
export function networkRewardsOf({
  identities,
  onlinePools,
  godStake,
  epochStart,
  nextValidation,
  recentBlocks,
}) {
  let totalStakingWeight = 0
  const counted = new Set()
  const onlineWeights = []
  for (const identity of identities ?? []) {
    if (VALIDATED_STATES.has(identity.state)) {
      const address = String(identity.address).toLowerCase()
      const weight = stakeWeight(Number(identity.stake) || 0)
      totalStakingWeight += weight
      counted.add(address)
      const delegatee = identity.delegatee
        ? String(identity.delegatee).toLowerCase()
        : null
      // Delegators validate through their pool when it is online (ValidatorsCache: pool.delegators).
      if (delegatee ? onlinePools.has(delegatee) : identity.online) {
        onlineWeights.push(weight)
      }
    }
  }
  if (!counted.has(GOD_ADDRESS)) {
    totalStakingWeight += stakeWeight(Number(godStake) || 0)
  }
  const end = Date.parse(nextValidation) / 1000
  const proposed = recentBlocks.filter((block) => !block.isEmpty).length
  return {
    totalStakingWeight,
    validators: onlineWeights.length,
    averageValidatorWeight:
      onlineWeights.length > 0
        ? onlineWeights.reduce((sum, weight) => sum + weight, 0) /
          onlineWeights.length
        : 0,
    epochDays:
      epochStart > 0 && end > epochStart ? (end - epochStart) / 86400 : 0,
    proposedBlockShare:
      recentBlocks.length > 0 ? proposed / recentBlocks.length : 1,
  }
}

/**
 * Reads the network data of the APY from the node with `rpc(method, ...params)`: every identity and the
 * last `sampleBlocks` blocks. Call it rarely, and only once the node is synced.
 */
export async function fetchNetworkRewards(rpc, sampleBlocks = 100) {
  const identities = (await rpc('dna_identities')) ?? []
  const pools = [
    ...new Set(
      identities
        .filter(
          ({state, delegatee}) => VALIDATED_STATES.has(state) && delegatee
        )
        .map(({delegatee}) => String(delegatee).toLowerCase())
    ),
  ]
  const onlinePools = new Set()
  await Promise.all(
    pools.map(async (pool) => {
      const identity = await rpc('dna_identity', pool)
      if (identity?.online) onlinePools.add(pool)
    })
  )
  const god = await rpc('dna_getBalance', GOD_ADDRESS)
  const epoch = await rpc('dna_epoch')
  const start = await rpc('bcn_blockAt', epoch.startBlock)
  const head = (await rpc('bcn_lastBlock')).height
  const heights = []
  for (
    let height = Math.max(1, head - sampleBlocks + 1);
    height <= head;
    height += 1
  ) {
    heights.push(height)
  }
  const recentBlocks = (
    await Promise.all(heights.map((height) => rpc('bcn_blockAt', height)))
  ).filter(Boolean)
  return networkRewardsOf({
    identities,
    onlinePools,
    godStake: god?.stake,
    epochStart: start?.timestamp ?? 0,
    nextValidation: epoch.nextValidation,
    recentBlocks,
  })
}
