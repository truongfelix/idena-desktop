import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ActionBar} from './actions'

const ME = '0xme'
const OTHER = '0xother'

jest.mock('../provider', () => ({
  useSocial: () => ({
    me: '0xme',
    names: {},
    targets: new Map([['p1', {level: 'post'}]]),
    sending: {canAct: true, pendingLikes: new Set()},
  }),
}))

const node = ({author, likes = 0, tips = 0}) => ({
  id: 'p1',
  call: {author, time: 0},
  likeCalls: Array.from({length: likes}, (_, i) => ({author: `0xl${i}`})),
  tips: Array.from({length: tips}, () => ({
    tipAmount: '5',
    amount: '5',
    sent: true,
  })),
  replies: [],
})

const render = (props) =>
  renderToStaticMarkup(
    <ActionBar onAnswers={() => {}} onProfile={() => {}} {...props} />
  )

const buttonsLabelled = (html, label) =>
  (html.match(new RegExp(`<button[^>]*aria-label="${label}"`, 'g')) || [])
    .length

describe('the counters of a post', () => {
  it('open who liked and tipped from the counts, without an eye button', () => {
    const html = render({node: node({author: OTHER, likes: 2, tips: 1})})
    expect(html).not.toContain('👁')
    // The likes count and the tips count.
    expect(buttonsLabelled(html, 'Who liked and tipped')).toBe(2)
    expect(buttonsLabelled(html, 'Like')).toBe(1)
    expect(buttonsLabelled(html, 'Tip')).toBe(1)
  })

  it('make no count a button while it is zero', () => {
    const html = render({node: node({author: OTHER})})
    expect(buttonsLabelled(html, 'Who liked and tipped')).toBe(0)
    expect(buttonsLabelled(html, 'Tip')).toBe(1)
  })

  it('show no Tip on one’s own post, only its tipped total', () => {
    const tipped = render({node: node({author: ME, tips: 1})})
    expect(buttonsLabelled(tipped, 'Tip')).toBe(0)
    expect(tipped).toContain('🪙 5')
    expect(buttonsLabelled(tipped, 'Who liked and tipped')).toBe(1)
    const untipped = render({node: node({author: ME})})
    expect(buttonsLabelled(untipped, 'Tip')).toBe(0)
    expect(untipped).not.toContain('🪙')
  })
})
