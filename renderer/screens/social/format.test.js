import {timeAgo} from './format'

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
