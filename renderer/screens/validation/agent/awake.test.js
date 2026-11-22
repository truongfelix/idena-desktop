import {EpochPeriod} from '../../../shared/types'
import {keepsAwake} from './awake'

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
})
