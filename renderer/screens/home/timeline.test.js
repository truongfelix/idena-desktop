import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {TimelineContent} from './timeline'
import {HistoryTab} from '../history/utils'

const history = {epoch: 232, ceremoniesComplete: true, ceremonies: []}

const render = (props) =>
  renderToStaticMarkup(
    <TimelineContent tab={HistoryTab.Ceremonies} isOwn {...props} />
  )

const STALE = 'A read from your node failed'
const UNREAD = 'The history could not be read from your node.'

describe("My Idena's timeline (B-317)", () => {
  it('shows the loading bars while nothing is read', () => {
    const html = render({})
    expect(html).toContain('chakra-skeleton')
    expect(html).not.toContain(UNREAD)
  })

  it('says the history could not be read when the first read failed', () => {
    const html = render({isError: true, error: new Error('timeout')})
    expect(html).toContain(UNREAD)
    expect(html).toContain('timeout')
    expect(html).not.toContain('chakra-skeleton')
  })

  it('keeps the timeline read before a failed refresh, with a line over it', () => {
    const html = render({history, isError: true, error: new Error('timeout')})
    expect(html).toContain(STALE)
    expect(html).toContain('No validation of this address')
    expect(html).not.toContain(UNREAD)
  })

  it('shows no failure line after a good read', () => {
    const html = render({history, isSuccess: true})
    expect(html).not.toContain(STALE)
  })

  it("shows each tab's empty text when the node has no history", () => {
    expect(render({isSuccess: true, history: null})).toContain(
      'No validation of this address'
    )
    expect(
      render({tab: HistoryTab.Mining, isSuccess: true, history: null})
    ).toContain('No mining reward recorded yet')
  })
})
