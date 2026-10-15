import {person, peopleToJson} from './people'
import {
  followedPeople,
  mergeLists,
  socialListsFromJson,
  socialListsToJson,
} from './lists'
import {a, b, c} from './test-helpers'

// Ported from the phone app's SocialListsTest.kt: a file exported by one app imports in the other.

describe('the Social lists file', () => {
  it('holds the names, the people and the topics', () => {
    const lists = {
      people: {
        [a]: person(a, {name: 'Anna', following: true}),
        [b]: person(b, {name: 'Bob'}),
      },
      topics: ['idena', 'flips'],
    }
    const json = socialListsToJson(lists)
    expect(json.version).toBe(2)
    // Sorted.
    expect(json.topics).toEqual(['flips', 'idena'])
    expect(socialListsFromJson(JSON.parse(JSON.stringify(json)))).toEqual({
      ...lists,
      topics: ['flips', 'idena'],
    })
  })

  it('still imports a contacts file of version 1', () => {
    const v1 = JSON.parse(
      JSON.stringify(
        peopleToJson({[a]: person(a, {name: 'Anna', following: true})})
      )
    )
    expect(v1.version).toBe(1)
    expect(socialListsFromJson(v1)).toEqual({
      people: {[a]: person(a, {name: 'Anna', following: true})},
      topics: [],
    })
    // Not an export.
    expect(socialListsFromJson({topics: ['idena']})).toBeNull()
  })

  it('leaves invalid topics out', () => {
    expect(
      socialListsFromJson({
        version: 2,
        people: [],
        topics: ['idena', 'r/idena', 'Idena', 'ab', 7, 'ok_name'],
      }).topics
    ).toEqual(['idena', 'ok_name'])
  })

  it('adds on import without removing', () => {
    const current = {
      people: {
        [a]: person(a, {name: 'Anna'}),
        [b]: person(b, {following: true}),
      },
      topics: ['idena'],
    }
    const imported = {
      people: {
        [a]: person(a, {following: true}),
        [c]: person(c, {name: 'Cleo'}),
      },
      topics: ['idena', 'flips'],
    }
    const result = mergeLists(current, imported)
    expect(result.added).toBe(1)
    expect(result.changed).toBe(1)
    expect(result.topicsAdded).toBe(1)
    expect(result.lists.topics).toEqual(['flips', 'idena'])
    expect(result.lists.people[a]).toEqual(
      person(a, {name: 'Anna', following: true})
    )
    expect(result.lists.people[b]).toEqual(person(b, {following: true}))
  })

  it('lists the people followed in name order', () => {
    const people = {
      [a]: person(a, {name: 'Zed', following: true}),
      [b]: person(b, {name: 'Anna'}),
      [c]: person(c, {following: true}),
    }
    expect(followedPeople(people).map(({address}) => address)).toEqual([a, c])
  })
})
