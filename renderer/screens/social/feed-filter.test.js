import {FeedPeriod, FeedSort} from './feed'
import {person} from './people'
import {
  DEFAULT_FEED_FILTER,
  applyFeedFilter,
  filterSummary,
  isDefaultFilter,
} from './feed-filter'
import {a, b, c} from './test-helpers'

// The phone app's feed filter (SocialFeedFilter.kt): the same posts, in the same order, named the same way.

const labels = {
  people: 'People I follow',
  topics: 'Topics I follow',
  both: 'People and topics I follow',
  sorts: {
    [FeedSort.Newest]: 'Newest posts',
    [FeedSort.Likes]: 'Most liked',
  },
  periods: {[FeedPeriod.Epoch]: 'This epoch', [FeedPeriod.Week]: '7 days'},
}

const post = (id, author, channel = '', height = id) => ({
  id,
  call: {author, channel, height},
  likeCalls: [],
  tips: [],
  replies: [],
})

describe('the feed filter', () => {
  it('opens on all posts, the latest activity first', () => {
    expect(isDefaultFilter(DEFAULT_FEED_FILTER)).toBe(true)
    expect(DEFAULT_FEED_FILTER.sort).toBe(FeedSort.Activity)
    expect(filterSummary(DEFAULT_FEED_FILTER, labels)).toBeNull()
  })

  it('names a filter that is not the default, the period only for a ranked order', () => {
    expect(filterSummary({...DEFAULT_FEED_FILTER, people: true}, labels)).toBe(
      'People I follow'
    )
    expect(
      filterSummary(
        {...DEFAULT_FEED_FILTER, people: true, topics: true},
        labels
      )
    ).toBe('People and topics I follow')
    expect(
      filterSummary({...DEFAULT_FEED_FILTER, sort: FeedSort.Newest}, labels)
    ).toBe('Newest posts')
    expect(
      filterSummary(
        {
          ...DEFAULT_FEED_FILTER,
          topics: true,
          sort: FeedSort.Likes,
          period: FeedPeriod.Week,
        },
        labels
      )
    ).toBe('Topics I follow · Most liked · 7 days')
  })

  it('shows the people and the topics followed, each only when asked', () => {
    const feed = [post(3, a), post(2, b, 'r/idena'), post(1, c)]
    const options = {
      people: {[a]: person(a, {following: true})},
      followedTopics: ['idena'],
      now: 0,
      epochStart: null,
    }
    const ids = (filter) =>
      applyFeedFilter(
        feed,
        {...DEFAULT_FEED_FILTER, sort: FeedSort.Newest, ...filter},
        options
      ).map(({id}) => id)
    expect(ids({})).toEqual([3, 2, 1])
    expect(ids({people: true})).toEqual([3])
    expect(ids({topics: true})).toEqual([2])
    expect(ids({people: true, topics: true})).toEqual([3, 2])
  })
})
