import {stillWaiting} from './sending'

const sent = (hash, height = null, likeOf = null) => ({
  hash,
  kind: likeOf === null ? 'post' : 'like',
  likeOf,
  height,
})

describe('the sent actions', () => {
  it('wait until the feed shows their block', () => {
    const like = sent('0xlike', null, 42)
    // Not in a block yet: kept whatever the feed shows.
    expect(stillWaiting([like], 11400005)).toEqual([like])
    const inBlock = {...like, height: 11400000}
    expect(stillWaiting([inBlock], 11399999)).toEqual([inBlock])
    expect(stillWaiting([inBlock], 11400000)).toEqual([])
  })

  it('leave one by one', () => {
    const post = sent('0xpost', 11400003)
    const like = sent('0xlike', 11400001, 42)
    const tip = sent('0xtip')
    expect(stillWaiting([post, like, tip], 11400002)).toEqual([post, tip])
  })
})
