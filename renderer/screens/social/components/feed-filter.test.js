import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {FeedFilterButton} from './feed-filter'
import {DEFAULT_FEED_FILTER} from '../feed-filter'

describe('the feed filter button', () => {
  // Inside the search field, the closed panel's box made the Feed page wider than the window (B-99): the panel
  // goes to a portal, out of the page's flow, and no part of it is in the field.
  it('keeps its panel out of the page', () => {
    const html = renderToStaticMarkup(
      <FeedFilterButton
        filter={DEFAULT_FEED_FILTER}
        onChange={() => {}}
        peopleCount={0}
        topicsCount={0}
        openList={() => {}}
      />
    )
    expect(html).toContain('Filter the feed')
    expect(html).not.toContain('chakra-popover__popper')
  })
})
