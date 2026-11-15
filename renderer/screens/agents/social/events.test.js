import {eventPending} from './events'

const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const ANN = '0xa110000000000000000000000000000000000001'

const node = (author, height, more = {}) => ({
  id: height,
  call: {author, message: 'text', height, index: 0},
  likeCalls: [],
  tips: [],
  replies: [],
  ...more,
})

describe('the events that run an agent', () => {
  const mine = (more) => node(ME, 100, more)
  const at = {point: 150, scanned: 300}

  test('an answer, a like, a tip after the read point, each when it is chosen', () => {
    const answered = {feed: [mine({replies: [node(ANN, 200)]})], me: ME}
    expect(eventPending(['answer'], answered, at)).toBe(true)
    expect(eventPending(['like', 'tip'], answered, at)).toBe(false)
    const liked = {
      feed: [mine({likeCalls: [{author: ANN, height: 200, index: 0}]})],
      me: ME,
    }
    expect(eventPending(['like'], liked, at)).toBe(true)
    const tipped = {feed: [mine({tips: [{from: ANN, height: 200}]})], me: ME}
    expect(eventPending(['tip'], tipped, at)).toBe(true)
  })

  test('a private message to it; not one it wrote, not one before the point, not from a blocked person', () => {
    const chat = (from, height) => ({
      feed: [],
      me: ME,
      conversations: [{others: [ANN], messages: [{from, height}]}],
    })
    expect(eventPending(['message'], chat(ANN, 200), at)).toBe(true)
    expect(eventPending(['message'], chat(ME, 200), at)).toBe(false)
    expect(eventPending(['message'], chat(ANN, 120), at)).toBe(false)
    expect(
      eventPending(
        ['message'],
        {...chat(ANN, 200), blocked: new Set([ANN])},
        at
      )
    ).toBe(false)
  })

  test('no event chosen, or no read point yet (its first run is the schedule’s): nothing', () => {
    const answered = {feed: [mine({replies: [node(ANN, 200)]})], me: ME}
    expect(eventPending([], answered, at)).toBe(false)
    expect(
      eventPending(['answer'], answered, {point: null, scanned: 300})
    ).toBe(false)
  })
})
