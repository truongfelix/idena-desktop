import {EpochPeriod} from '../../../shared/types'
import {AWAKE_LEAD_MS, keepsAwake} from './awake'

describe("The window's timers stay awake for an agent in the validation (B-302)", () => {
  it('from the lottery to the end of the long session, while an agent acts', () => {
    ;[
      EpochPeriod.FlipLottery,
      EpochPeriod.ShortSession,
      EpochPeriod.LongSession,
    ].forEach((period) =>
      expect(keepsAwake({mode: 'autopilot', paused: false, period})).toBe(true)
    )
    expect(
      keepsAwake({mode: 'report', paused: false, period: 'LongSession'})
    ).toBe(true)
  })

  it('not outside the ceremony, nor without an agent, nor paused', () => {
    expect(
      keepsAwake({mode: 'autopilot', paused: false, period: EpochPeriod.None})
    ).toBe(false)
    expect(
      keepsAwake({
        mode: 'autopilot',
        paused: false,
        period: EpochPeriod.AfterLongSession,
      })
    ).toBe(false)
    expect(
      keepsAwake({mode: 'autopilot', paused: false, period: undefined})
    ).toBe(false)
    expect(
      keepsAwake({mode: null, paused: false, period: EpochPeriod.ShortSession})
    ).toBe(false)
    expect(
      keepsAwake({
        mode: 'suggest',
        paused: true,
        period: EpochPeriod.ShortSession,
      })
    ).toBe(false)
  })

  it('from AWAKE_LEAD_MS before the validation, while the epoch still says None', () => {
    const at = {
      mode: 'autopilot',
      paused: false,
      period: EpochPeriod.None,
      nextValidation: 10 * AWAKE_LEAD_MS,
    }
    expect(keepsAwake({...at, now: 9 * AWAKE_LEAD_MS - 1})).toBe(false)
    expect(keepsAwake({...at, now: 9 * AWAKE_LEAD_MS})).toBe(true)
    // Past the validation's time with no ceremony period: the period decides.
    expect(keepsAwake({...at, now: 10 * AWAKE_LEAD_MS})).toBe(false)
  })
})
