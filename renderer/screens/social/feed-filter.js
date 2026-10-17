import {FeedPeriod, FeedSort, sortFeed} from './feed'
import {followingFeed} from './people'

// The feed's filter, behind the icon at the end of the search bar, as the phone app's (SocialFeedFilter.kt): whose
// posts (all, or those of the people and the topics followed), the order, and the period of a ranked order. A line
// under the search names a filter that is not the default, with ✕ to reset it.

/** The feed as it opens: all posts, the latest activity first (the period counts only for a ranked order). */
export const DEFAULT_FEED_FILTER = {
  people: false,
  topics: false,
  sort: FeedSort.Activity,
  period: FeedPeriod.Epoch,
}

/** Whether a sort ranks the posts (by likes, answers or tips) over a period. */
export const isRanked = (sort) =>
  ![FeedSort.Newest, FeedSort.Activity].includes(sort)

/** Whether only followed posts show. */
export const isFollowed = (filter) => filter.people || filter.topics

/** Whether the filter is the feed as it opens. */
export const isDefaultFilter = (filter) =>
  !isFollowed(filter) && filter.sort === FeedSort.Activity

/**
 * One line naming a filter that is not the default ("People I follow · Most liked · This epoch"), from `labels`
 * (the shown texts: {people, topics, both, sorts: {sort: text}, periods: {period: text}}); null for the default.
 */
export function filterSummary(filter, labels) {
  if (isDefaultFilter(filter)) return null
  let whose = null
  if (filter.people && filter.topics) whose = labels.both
  else if (filter.people) whose = labels.people
  else if (filter.topics) whose = labels.topics
  return [
    whose,
    filter.sort !== FeedSort.Activity ? labels.sorts[filter.sort] : null,
    isRanked(filter.sort) ? labels.periods[filter.period] : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The feed (newest first) as the filter shows it: the followed posts only (the people of `people` marked Following,
 * the topics of `followedTopics`) when it asks for them, in its order (sortFeed: `now`, `epochStart`).
 */
export function applyFeedFilter(
  feed,
  filter,
  {people, followedTopics, now, epochStart}
) {
  const shown = isFollowed(filter)
    ? followingFeed(
        feed,
        filter.people ? people : {},
        filter.topics ? followedTopics : []
      )
    : feed
  return sortFeed(shown, filter.sort, {
    period: filter.period,
    now,
    epochStart,
  })
}
