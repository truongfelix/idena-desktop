import {LIKE} from './contract'
import {likeCount, socialFeed} from './feed'
import {followingFeed, person} from './people'
import {
  cleanTopics,
  postTopic,
  topicFeed,
  topicList,
  topicOf,
  typedTopic,
} from './topics'
import {a, authorsOf, b, post} from './test-helpers'

// Ported from the phone app's SocialTopicsTest.kt: both apps read topics the same way.

const feedOf = (...posts) => socialFeed(posts, authorsOf(posts))

describe('topics', () => {
  it('come from the channel', () => {
    expect(topicOf('r/idena')).toBe('idena')
    expect(topicOf('r/a_b_9')).toBe('a_b_9')
    expect(topicOf(`r/${'a'.repeat(21)}`)).toBe('a'.repeat(21))
    expect(topicOf(`r/${'a'.repeat(22)}`)).toBeNull()
    expect(topicOf('r/ab')).toBeNull()
    // Upper case is never written.
    expect(topicOf('r/Idena')).toBeNull()
    // A colon: the website reads channels ending in discuss:<id> as comments.
    expect(topicOf('r/x:discuss:4')).toBeNull()
    expect(topicOf('idena')).toBeNull()
    expect(topicOf('')).toBeNull()
    expect(topicOf('discuss:4')).toBeNull()
  })

  it('are typed in the editor', () => {
    expect(typedTopic('Idena')).toBe('idena')
    expect(typedTopic(' r/idena ')).toBe('idena')
    expect(typedTopic('id')).toBeNull()
    expect(typedTopic('idena social')).toBeNull()
    expect(typedTopic('idéna')).toBeNull()
    expect(typedTopic('')).toBeNull()
  })

  it('keep their posts in the feed with their threads', () => {
    const feed = feedOf(
      post('p1', a, 'no topic', 100),
      post('p2', b, 'in a topic', 110, {channel: 'r/idena'}),
      post('p3', a, 'a reply', 120, {replyTo: '2'}),
      post('p4', b, 'a comment', 130, {replyTo: '3', channel: 'discuss:3'}),
      post('p5', a, LIKE, 140, {replyTo: '2'}),
      post('p6', b, 'an invalid topic', 150, {channel: 'r/X'}),
      post('p7', a, 'an answer may not name a topic', 160, {
        replyTo: '1',
        channel: 'r/idena',
      })
    )
    // Newest first; other channels left out.
    expect(feed.map(({id}) => id)).toEqual([2, 1])
    const inTopic = feed.find(({id}) => id === 2)
    expect(postTopic(inTopic)).toBe('idena')
    expect(inTopic.replies.map(({id}) => id)).toEqual([3])
    expect(inTopic.replies[0].replies.map(({id}) => id)).toEqual([4])
    expect(likeCount(inTopic)).toBe(1)
    expect(postTopic(feed.find(({id}) => id === 1))).toBeNull()
    expect(feed.find(({id}) => id === 1).replies).toHaveLength(0)
    expect(topicFeed(feed, 'idena').map(({id}) => id)).toEqual([2])
  })

  it('are listed by latest activity', () => {
    const feed = feedOf(
      post('p1', a, 'first', 100, {channel: 'r/idena'}),
      post('p2', b, 'second', 110, {channel: 'r/news'}),
      post('p3', a, 'third', 120, {channel: 'r/idena'}),
      post('p4', b, 'late reply in news', 300, {replyTo: '2'}),
      post('p5', a, 'no topic', 400)
    )
    expect(topicList(feed)).toEqual([
      {name: 'news', posts: 1, lastHeight: 300, lastTime: 300},
      {name: 'idena', posts: 2, lastHeight: 120, lastTime: 120},
    ])
    // The search keeps the names holding it.
    expect(topicList(feed, 'r/DEN').map(({name}) => name)).toEqual(['idena'])
    expect(topicList(feed, 'sport')).toEqual([])
  })

  it('make the Following feed with the people followed', () => {
    const feed = feedOf(
      post('p1', a, 'a, no topic', 100),
      post('p2', b, 'b in idena', 110, {channel: 'r/idena'}),
      post('p3', b, 'b in news', 120, {channel: 'r/news'})
    )
    const people = {[a]: person(a, {following: true})}
    expect(followingFeed(feed, people).map(({id}) => id)).toEqual([1])
    expect(followingFeed(feed, people, ['idena']).map(({id}) => id)).toEqual([
      2, 1,
    ])
    expect(
      followingFeed(feed, {}, ['idena', 'news']).map(({id}) => id)
    ).toEqual([3, 2])
  })

  it('are kept as valid names, once each, sorted', () => {
    expect(
      cleanTopics(['news', 'idena', 'r/idena', 'Idena', 'ab', 7, 'news'])
    ).toEqual(['idena', 'news'])
    expect(cleanTopics(null)).toEqual([])
  })
})
