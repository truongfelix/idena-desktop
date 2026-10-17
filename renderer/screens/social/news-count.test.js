import {socialNewsCount} from './news-count'

describe('the Social news count', () => {
  it('adds the new activity, the unread conversations and the offers', () => {
    expect(
      socialNewsCount({
        unread: [{}, {}],
        unreadConversations: 3,
        offersTo: [{}],
      })
    ).toBe(6)
  })

  it('is 0 before Social is read', () => {
    expect(socialNewsCount()).toBe(0)
    expect(socialNewsCount({})).toBe(0)
  })
})
