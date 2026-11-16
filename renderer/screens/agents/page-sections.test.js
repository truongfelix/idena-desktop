import {eventsOffered} from './page-sections'

// B-276: When it runs offers only the events the agent reads, none when it reads none.
describe('the events the agent page offers', () => {
  const names = {
    like: 'a like',
    answer: 'an answer',
    tip: 'a tip',
    message: 'a private message',
    tag: 'a post that tags it',
  }
  const ids = (reads) => eventsOffered({reads}, names).map(([id]) => id)

  test('none for an agent that reads none of them', () => {
    expect(ids({})).toEqual([])
    expect(ids({posts: {window: 'day'}, own: true})).toEqual([])
  })

  test('only those it reads', () => {
    expect(ids({notifications: true})).toEqual(['like', 'answer', 'tip'])
    expect(ids({messages: true})).toEqual(['message'])
    expect(ids({tags: {perDay: 5}})).toEqual(['tag'])
    expect(eventsOffered({reads: {messages: true}}, names)).toEqual([
      ['message', 'a private message'],
    ])
  })
})
