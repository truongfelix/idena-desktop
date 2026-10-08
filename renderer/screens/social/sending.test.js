import {draftToPutBack, stillWaiting} from './sending'

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

describe('a draft whose send failed', () => {
  const draft = {text: 'hello', image: {bytes: [1]}, textOnIpfs: true}

  it('goes back to an editor that holds nothing', () => {
    expect(draftToPutBack(draft, {text: '', image: null})).toBe(draft)
    expect(draftToPutBack(draft, {text: '  \n', image: null})).toBe(draft)
  })

  it('leaves an editor that holds a text or an image as it is', () => {
    expect(draftToPutBack(draft, {text: 'new text', image: null})).toBeNull()
    expect(draftToPutBack(draft, {text: '', image: {bytes: [2]}})).toBeNull()
  })

  it('is nothing for a like or a tip', () => {
    expect(draftToPutBack(null, {text: '', image: null})).toBeNull()
  })
})
