import {timeAgo, tipText} from './format'

// Ported from the phone app's SocialTest.kt: both apps read idena.social the same way.

describe('times', () => {
  it('say how long ago, as Reddit', () => {
    expect(timeAgo(1000, 1005)).toBe('5s')
    expect(timeAgo(1000, 1000 + 600)).toBe('10min')
    expect(timeAgo(1000, 1000 + 7 * 3600)).toBe('7h')
    expect(timeAgo(1000, 1000 + 86400)).toBe('1d')
    expect(timeAgo(1000, 1000 + 150 * 86400)).toBe('5mo')
    expect(timeAgo(1000, 1000 + 2 * 365 * 86400)).toBe('2y')
    expect(timeAgo(1000, 900)).toBe('now')
  })
})

describe('tip amounts', () => {
  it('show at most 3 decimals, as idena.social', () => {
    expect(tipText(500)).toBe('500')
    expect(tipText(2.5)).toBe('2.5')
    expect(tipText(26380.455)).toBe('26380.455')
    expect(tipText(0.1 + 0.2)).toBe('0.3')
    // A tip of the smallest unit (v5, from the tips balance).
    expect(tipText(1e-18)).toBe('0.000')
    expect(tipText(0)).toBe('0')
  })
})
