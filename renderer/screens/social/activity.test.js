import i18next from 'i18next'
import translation from '../../../locales/en/translation.json'
import {ActivityKind, noticesTitle, socialProfile} from './activity'
import {LIKE} from './contract'
import {socialFeed} from './feed'
import {identityStatus} from './format'
import {a, authorsOf, b, c, post, tip} from './test-helpers'

// Ported from the phone app's SocialTest.kt: both apps read idena.social the same way.

describe('a profile', () => {
  it('lists what its identity did', () => {
    const posts = [
      post('p1', a, "a's post", 100),
      post('p2', b, "b's reply", 110, {replyTo: '1'}),
      post('p3', a, LIKE, 120, {replyTo: '2', channel: 'discuss:2'}),
      post('p4', a, "a's comment on b's reply", 130, {
        replyTo: '2',
        channel: 'discuss:2',
      }),
      post('p5', c, "c's comment", 140, {replyTo: '2', channel: 'discuss:2'}),
      post('p6', a, "a answers c's comment", 150, {
        replyTo: '5',
        channel: 'discuss:2',
      }),
      post('p7', b, LIKE, 160, {replyTo: '1'}),
      post('p8', a, "a's reply with media", 170, {
        replyTo: '1',
        hasMedia: true,
      }),
      post('p9', b, "b's post", 180),
      post('p10', a, "a's second post", 190),
    ]
    const tips = [
      tip('t1', b, '1', '3', '3', 200),
      tip('t2', a, '9', '2', '2', 210),
      tip('t3', c, '5', '1', '1', 220),
    ]
    const profile = socialProfile(
      socialFeed(posts, authorsOf(posts), tips),
      a.toUpperCase().replace('0X', '0x')
    )
    expect(profile.address).toBe(a)
    expect(profile.posts.map((i) => i.node.id)).toEqual([10, 1])
    expect(profile.replies.map((i) => i.node.id)).toEqual([8])
    expect(profile.replies[0].parent.hash).toBe('p1')
    expect(profile.comments.map((i) => i.node.id)).toEqual([6, 4])
    expect(profile.comments[0].parent.hash).toBe('p5')
    expect(profile.comments[1].parent.hash).toBe('p2')
    expect(profile.likes.map((i) => i.node.call.hash)).toEqual(['p2'])
    expect(profile.likes[0].like.hash).toBe('p3')
    expect(profile.media.map((i) => i.node.id)).toEqual([8])
    expect(profile.tips.map((i) => i.tip.hash)).toEqual(['t2'])
    expect(profile.likesReceived).toBe(1)
    expect(profile.tipsReceived).toBe(3)
    expect(profile.tipsGiven).toBe(2)
    expect(
      new Set(
        [...profile.posts, ...profile.comments, ...profile.tips].map(
          (i) => i.threadId
        )
      )
    ).toEqual(new Set([1, 10, 9]))
  })

  it('is empty without posts', () => {
    const profile = socialProfile(
      socialFeed([post('p1', a, "a's post", 100)], {1: a}),
      c
    )
    expect(profile.posts).toEqual([])
    expect(profile.likes).toEqual([])
    expect(
      profile.likesReceived + profile.tipsReceived + profile.tipsGiven
    ).toBe(0)
    expect(socialProfile([], a).posts).toEqual([])
  })

  it('names identity states as idena.social does', () => {
    expect(identityStatus('Undefined')).toBe('Not validated')
    expect(identityStatus('')).toBe('Not validated')
    expect(identityStatus('Candidate')).toBe('Candidate')
  })
})

describe('the notice of several new things', () => {
  const i18n = i18next.createInstance()
  i18n.init({
    resources: {en: {translation}},
    lng: 'en',
    keySeparator: false,
    initImmediate: false,
    interpolation: {escapeValue: false},
  })
  const t = i18n.t.bind(i18n)
  const news = (...kinds) => kinds.map((kind) => ({kind}))

  it('names each kind there is with its count, as the phone app', () => {
    expect(
      noticesTitle(
        news(
          ActivityKind.Like,
          ActivityKind.Like,
          ActivityKind.Reply,
          ActivityKind.Tip
        ),
        t
      )
    ).toBe('4 new on your posts: 2 likes, 1 reply, 1 tip')
    expect(
      noticesTitle(
        news(
          ActivityKind.Tip,
          ActivityKind.Comment,
          ActivityKind.Like,
          ActivityKind.Reply,
          ActivityKind.Tip
        ),
        t
      )
    ).toBe('5 new on your posts: 1 like, 2 replies, 2 tips')
  })

  it('leaves out the kinds there is none of', () => {
    expect(noticesTitle(news(ActivityKind.Like, ActivityKind.Like), t)).toBe(
      '2 new on your posts: 2 likes'
    )
    expect(noticesTitle(news(ActivityKind.Comment, ActivityKind.Tip), t)).toBe(
      '2 new on your posts: 1 reply, 1 tip'
    )
  })
})
