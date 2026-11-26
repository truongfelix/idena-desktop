import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IdentityTimeline, TimelineContent} from './timeline'
import {useIdentityHistory} from '../history/hooks'
import {useChainState} from '../../shared/providers/chain-context'
import {HistoryTab} from '../history/utils'

// The identity card and its machines are not rendered here.
jest.mock('./components', () => ({UserInlineCard: () => null}))
jest.mock('next/router', () => ({
  useRouter: () => ({query: {}, pathname: '/home', replace: () => {}}),
}))
jest.mock('../history/hooks', () => ({useIdentityHistory: jest.fn()}))
jest.mock('../../shared/providers/chain-context', () => ({
  useChainState: jest.fn(),
}))

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

describe("My Idena's timeline with its node down (B-317)", () => {
  // The read waits while the node is offline (and starts again when it is back), so nothing is read and no read
  // fails: the page says so instead of loading bars for good, also before the own address is known.
  it('says the history waits for the node, not loading bars', () => {
    const html = render({offline: true})
    expect(html).toContain('The history shows once your node answers.')
    expect(html).not.toContain('chakra-skeleton')
  })

  it('keeps a timeline already read while the node is down, saying it may be out of date', () => {
    const html = render({history, offline: true})
    expect(html).toContain('No validation of this address')
    expect(html).toContain(STALE)
    expect(html).not.toContain('once your node answers')
  })
})

describe("My Idena's timeline and the node's state (B-317)", () => {
  const timeline = (chain) => {
    useChainState.mockReturnValue(chain)
    useIdentityHistory.mockClear()
    useIdentityHistory.mockReturnValue({})
    const html = renderToStaticMarkup(<IdentityTimeline address="0x1" isOwn />)
    const [, options] = useIdentityHistory.mock.calls[0]
    return {html, enabled: options?.enabled}
  }

  it('reads while the node is online', () => {
    const {html, enabled} = timeline({offline: false, loading: false})
    expect(enabled).toBe(true)
    expect(html).toContain('chakra-skeleton')
  })

  it("waits for the app's first answer from the node with the loading bars", () => {
    const {html, enabled} = timeline({offline: true, loading: true})
    expect(enabled).toBe(false)
    expect(html).toContain('chakra-skeleton')
    expect(html).not.toContain('once your node answers')
  })

  it('says it waits for the node once the node did not answer', () => {
    const {html, enabled} = timeline({offline: true, loading: false})
    expect(enabled).toBe(false)
    expect(html).toContain('The history shows once your node answers.')
  })
})
