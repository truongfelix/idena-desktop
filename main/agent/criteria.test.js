const {normalizeCriteria} = require('./criteria')
const {normalizeAgent} = require('./profiles')

// B-266: the criteria of a read action (`who`) and of an action on others (`onlyTo`), each field checked as saved.

const A = `0x${'a'.repeat(40)}`
const B = `0x${'B'.repeat(40)}`

describe('the criteria as saved', () => {
  test('each field checked; none set reads as none', () => {
    expect(
      normalizeCriteria(
        {
          only: [A, B, 'nope', A],
          except: [],
          states: ['Human', 'Vouched', 'King'],
          trustAbove: '50',
          minAge: 2.5,
          minStake: '1000.5',
          mustWords: [' Idena ', '', 'idena'],
        },
        {withWords: true}
      )
    ).toEqual({
      only: [A, B.toLowerCase()],
      except: [],
      states: ['Vouched', 'Human'],
      trustAbove: 50,
      minAge: null,
      minStake: 1000.5,
      mustWords: ['idena'],
      notWords: [],
    })
    expect(normalizeCriteria({states: [], trustAbove: ''})).toBeNull()
    expect(normalizeCriteria(null)).toBeNull()
    // Words only on reads.
    expect(normalizeCriteria({mustWords: ['x']})).toBeNull()
  })

  test("kept on the actions' rows: `who` on the reads of others, `onlyTo` on the actions on others", () => {
    const agent = normalizeAgent({
      actions: {
        readPosts: {
          level: 'alone',
          window: 'count',
          count: 5,
          who: {states: ['Human']},
        },
        tip: {level: 'ask', limit: 5, amount: 1, onlyTo: {trustAbove: 10}},
        post: {level: 'alone', onlyTo: {states: ['Human']}},
        like: {level: 'ask', onlyTo: {states: []}},
      },
    })
    expect(agent.actions.readPosts.who).toMatchObject({states: ['Human']})
    expect(agent.actions.tip.onlyTo).toMatchObject({trustAbove: 10})
    // Its own posts have no one to pick; criteria set to nothing are none.
    expect(agent.actions.post.onlyTo).toBeUndefined()
    expect(agent.actions.like.onlyTo).toBeUndefined()
  })
})
