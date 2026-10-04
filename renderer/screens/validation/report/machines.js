import {assign, createMachine} from 'xstate'
import {log} from 'xstate/lib/actions'
import {callRpc} from '../../../shared/utils/utils'
import {ValidationResult, ValidationSummaryStatus} from './types'

const validatedStates = ['Newbie', 'Verified', 'Human']

export const validationReportMachine = createMachine({
  context: {
    earnings: 0,
    missedRewards: 0,
    earningsScore: 0,
    lastValidationScore: {
      short: {},
      long: {},
    },
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        FETCH: 'fetching',
      },
    },
    fetching: {
      entry: [
        assign({
          identity: (_, {identity}) => identity,
          epochNumber: (_, {epochNumber}) => epochNumber,
        }),
      ],
      invoke: {
        // Recorded by the node while it applied the ceremony block; null when it did not.
        src: (_, {epochNumber, identity: {address}}) =>
          callRpc('dna_validationSummary', address, epochNumber),
        onDone: [
          {target: 'notRecorded', cond: (_, {data}) => !data},
          {
            target: 'validationFailed',
            cond: (_, {data}) => data.validationFailed,
          },
          {
            target: 'notParticipated',
            cond: (_, {data}) =>
              !data.participated &&
              ['Undefined', 'Invite'].includes(data.prevState),
          },
          {target: 'fetched'},
        ],
        onError: 'unavailable',
      },
    },
    fetched: {
      entry: [
        log(),
        assign(
          (
            context,
            {
              data: {
                prevState,
                state,
                shortAnswers,
                longAnswers,
                shortAnswersCount,
                penalized,
                missed,
                rewards,
              },
            }
          ) => {
            const safeNumber = (num) => Number(num ?? 0)

            const maybePenaltyReward = (
              (cond) => (plannedReward) =>
                cond ? 0 : plannedReward
            )(penalized)

            const earnedReward = (k) => safeNumber(rewards[k].earned)
            const missedReward = (k) => safeNumber(rewards[k].missed)

            const {totalEarnedReward, totalMissedReward} = Object.keys(
              rewards
            ).reduce(
              // eslint-disable-next-line no-shadow
              ({totalEarnedReward, totalMissedReward}, key) => ({
                totalEarnedReward:
                  safeNumber(totalEarnedReward) + earnedReward(key),
                totalMissedReward:
                  safeNumber(totalMissedReward) + missedReward(key),
              }),
              {}
            )

            const flipScore = ({point, flipsCount}) =>
              flipsCount ? point / flipsCount : undefined

            const isValidated = validatedStates.includes(state)

            const lastValidationScore = {
              short: {
                ...shortAnswers,
                score: flipScore(shortAnswers),
              },
              long: {
                ...longAnswers,
                score: flipScore(longAnswers),
              },
            }

            // eslint-disable-next-line no-nested-ternary
            const validationResult = isValidated
              ? penalized
                ? ValidationResult.Penalty
                : ValidationResult.Success
              : // eslint-disable-next-line no-nested-ternary
              missed
              ? shortAnswersCount
                ? ValidationResult.LateSubmission
                : ValidationResult.MissedValidation
              : ValidationResult.WrongAnswers

            const totalReward = totalEarnedReward + totalMissedReward

            return {
              ...context,
              status: ValidationSummaryStatus.Recorded,
              prevState,
              newState: state,
              isValidated,
              validationResult,
              earnings: totalEarnedReward,
              totalMissedReward,
              earningsScore: totalReward ? totalEarnedReward / totalReward : 0,
              validationReward: earnedReward('validation'),
              missedValidationReward: missedReward('validation'),
              invitationReward: maybePenaltyReward(earnedReward('invitations')),
              missedInvitationReward: missedReward('invitations'),
              inviteeReward: maybePenaltyReward(earnedReward('invitee')),
              missedInviteeReward: missedReward('invitee'),
              flipReward: earnedReward('flips'),
              missedFlipReward: missedReward('flips'),
              extraFlipReward: earnedReward('extraFlips'),
              missedExtraFlipReward: missedReward('extraFlips'),
              flipReportReward: earnedReward('reports'),
              missedFlipReportReward: missedReward('reports'),
              stakingReward: earnedReward('staking'),
              missedStakingReward: missedReward('staking'),
              candidateReward: earnedReward('candidate'),
              missedCandidateReward: missedReward('candidate'),
              lastValidationScore,
            }
          }
        ),
      ],
    },
    notRecorded: {
      entry: [assign({status: ValidationSummaryStatus.NotRecorded})],
    },
    validationFailed: {
      entry: [assign({status: ValidationSummaryStatus.ValidationFailed})],
    },
    notParticipated: {
      entry: [assign({status: ValidationSummaryStatus.NotParticipated})],
    },
    unavailable: {
      entry: [
        assign({status: ValidationSummaryStatus.Unavailable}),
        log((_, {data}) => data?.message),
      ],
    },
  },
})
