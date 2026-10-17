import {PostTarget} from './contract'
import {ProfileCall, withCallbackGas} from './profiles'
import {actionKey, draftTarget, draftToPutBack, stillWaiting} from './sending'

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

describe('draftTarget', () => {
  it('puts a new post in the topic typed', () => {
    expect(draftTarget(PostTarget.newPost(), ' R/Idena ')).toEqual({
      level: null,
      replyTo: null,
      channel: 'r/idena',
    })
    expect(draftTarget(PostTarget.newPost(), '  ')).toEqual(
      PostTarget.newPost()
    )
    expect(() => draftTarget(PostTarget.newPost(), 'no way')).toThrow(
      'not a topic name'
    )
  })

  it('keeps an answer where it goes', () => {
    expect(draftTarget(PostTarget.onReply(4), 'idena')).toEqual(
      PostTarget.onReply(4)
    )
  })
})

describe('an action waiting for its block', () => {
  const member = '0xbbbb000000000000000000000000000000000002'

  it('is the same action whatever the callback gas the dry run sized', () => {
    const fresh = ProfileCall.vouch(member)
    const sized = withCallbackGas(fresh, 300000, 1200000)
    expect(sized.argument).not.toBe(fresh.argument)
    expect(actionKey(sized)).toBe(actionKey(fresh))
  })

  it('is another action for another method or person', () => {
    expect(actionKey(ProfileCall.trust(member))).not.toBe(
      actionKey(ProfileCall.untrust(member))
    )
    expect(actionKey(ProfileCall.trust(member))).not.toBe(
      actionKey(ProfileCall.trust('r/idena_topic'))
    )
  })
})
