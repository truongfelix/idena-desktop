import {interpret} from 'xstate'
import {callRpc} from '../../../shared/utils/utils'
import {validationReportMachine} from './machines'
import {ValidationResult, ValidationSummaryStatus} from './types'

jest.mock('../../../shared/utils/utils', () => ({callRpc: jest.fn()}))

const ADDRESS = '0x0000000000000000000000000000000000000001'

const reward = (earned, missed, reason) => ({
  earned,
  missed: missed ?? null,
  reason,
})

const summary = (props) => ({
  epoch: 228,
  address: ADDRESS,
  validationFailed: false,
  participated: true,
  prevState: 'Verified',
  state: 'Verified',
  approved: true,
  missed: false,
  penalized: false,
  shortAnswers: {point: 5, flipsCount: 6},
  longAnswers: {point: 20, flipsCount: 22},
  shortAnswersCount: 6,
  longAnswersCount: 24,
  rewards: {
    validation: reward('0', '0'),
    flips: reward('30'),
    extraFlips: reward('0'),
    invitations: reward('0'),
    invitee: reward('0'),
    reports: reward('10'),
    candidate: reward('0', '0'),
    staking: reward('60', '0'),
  },
  ...props,
})

// The machine's context once the summary (or the error) is in.
async function report(answer) {
  if (answer instanceof Error) callRpc.mockRejectedValueOnce(answer)
  else callRpc.mockResolvedValueOnce(answer)
  const service = interpret(validationReportMachine).start()
  service.send('FETCH', {epochNumber: 228, identity: {address: ADDRESS}})
  await new Promise((resolve) => {
    service.onTransition((state) => {
      if (!state.matches('fetching')) resolve()
    })
  })
  const {context} = service.state
  service.stop()
  return context
}

beforeAll(() => {
  // The machine logs the summary it receives.
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

beforeEach(() => callRpc.mockReset())

describe('validation report from dna_validationSummary', () => {
  it('asks the node for the address at the epoch', async () => {
    await report(summary())
    expect(callRpc).toHaveBeenCalledWith('dna_validationSummary', ADDRESS, 228)
  })

  it('says when the node did not record the epoch', async () => {
    const context = await report(null)
    expect(context.status).toBe(ValidationSummaryStatus.NotRecorded)
    expect(context.epochNumber).toBe(228)
  })

  it('says when the address had no identity at the ceremony', async () => {
    const context = await report(
      summary({participated: false, prevState: 'Undefined', state: 'Undefined'})
    )
    expect(context.status).toBe(ValidationSummaryStatus.NotParticipated)
  })

  it('says when nobody was validated', async () => {
    const context = await report({
      epoch: 228,
      address: ADDRESS,
      validationFailed: true,
      participated: false,
      prevState: '',
      state: '',
    })
    expect(context.status).toBe(ValidationSummaryStatus.ValidationFailed)
  })

  it('says when the node cannot answer', async () => {
    const context = await report(
      new Error('the method dna_validationSummary does not exist')
    )
    expect(context.status).toBe(ValidationSummaryStatus.Unavailable)
  })

  it('reports a validated identity from the summary', async () => {
    const context = await report(summary())
    expect(context.status).toBe(ValidationSummaryStatus.Recorded)
    expect(context.isValidated).toBe(true)
    expect(context.validationResult).toBe(ValidationResult.Success)
    expect(context.earnings).toBe(100)
    expect(context.totalMissedReward).toBe(0)
    expect(context.earningsScore).toBe(1)
    expect(context.lastValidationScore.short.score).toBeCloseTo(5 / 6)
  })

  it('takes the result from the summary, not from the identity today', async () => {
    const context = await report(
      summary({
        state: 'Suspended',
        missed: true,
        shortAnswers: {point: 0, flipsCount: 0},
        longAnswers: {point: 0, flipsCount: 0},
        shortAnswersCount: 0,
        rewards: {
          ...summary().rewards,
          flips: reward('0', null, 'missed'),
          reports: reward('0'),
          staking: reward('0', '33.8', 'not_validated'),
        },
      })
    )
    expect(context.isValidated).toBe(false)
    expect(context.validationResult).toBe(ValidationResult.MissedValidation)
    expect(context.earnings).toBe(0)
    expect(context.totalMissedReward).toBeCloseTo(33.8)
    expect(context.earningsScore).toBe(0)
    expect(context.lastValidationScore.short.score).toBeUndefined()
  })

  it('scores earnings against everything that could be earned', async () => {
    const context = await report(
      summary({
        penalized: true,
        penaltyReason: 'WrongWords',
        rewards: {
          ...summary().rewards,
          flips: reward('0', null, 'penalty'),
          reports: reward('0'),
          staking: reward('0', '60', 'penalty'),
          invitations: reward('20'),
        },
      })
    )
    expect(context.validationResult).toBe(ValidationResult.Penalty)
    expect(context.earningsScore).toBeCloseTo(20 / 80)
    expect(context.invitationReward).toBe(0)
  })
})
