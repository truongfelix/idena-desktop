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
  it('holds the names, the people, the topics, the blocks and the hidden words', () => {
    const lists = {
      people: {
        [a]: person(a, {name: 'Anna', following: true}),
        [b]: person(b, {name: 'Bob', muted: true}),
        [c]: person(c, {blocked: true}),
      },
      topics: ['idena', 'flips'],
      words: ['spam', 'free coins'],
      hiddenPosts: [`0x${'ab'.repeat(32)}`],
      blockedTopics: ['scam_topic'],
    }
    const json = socialListsToJson(lists)
    expect(json.version).toBe(4)
    // Sorted.
    expect(json.hiddenWords).toEqual(['free coins', 'spam'])
    expect(json.topics).toEqual(['flips', 'idena'])
    expect(socialListsFromJson(JSON.parse(JSON.stringify(json)))).toEqual({
      ...lists,
      topics: ['flips', 'idena'],
      words: ['free coins', 'spam'],
    })
  })

  it('reads the file the phone app writes', () => {
    // As SocialLists.kt writes it (version 4).
    const hash = `0x${'ab'.repeat(32)}`
    const phone = {
      version: 4,
      people: [
        {
          address: c,
          name: '',
          following: false,
          message: false,
          blocked: true,
          muted: false,
        },
      ],
      topics: ['idena'],
      hiddenWords: ['free coins'],
      hiddenPosts: [hash],
      blockedTopics: ['scam_topic'],
    }
    expect(socialListsFromJson(phone)).toEqual({
      people: {[c]: person(c, {blocked: true})},
      topics: ['idena'],
      words: ['free coins'],
      hiddenPosts: [hash],
      blockedTopics: ['scam_topic'],
    })
    // And writes the same keys.
    expect(
      Object.keys(socialListsToJson(socialListsFromJson(phone))).sort()
    ).toEqual(Object.keys(phone).sort())
  })

  it('imports a version 3 file with nobody muted, and adds mutes on import', () => {
    const v3 = {
      version: 3,
      people: [
        {
          address: a,
          name: 'Anna',
          following: false,
          message: false,
          blocked: false,
        },
      ],
    }
    expect(socialListsFromJson(v3).people[a]).toEqual(person(a, {name: 'Anna'}))
    // A mute set on either side stays, and a person only muted is kept in the list.
    const file = socialListsFromJson({
      version: 4,
      people: [
        {address: a, muted: true},
        {address: b, muted: true},
      ],
    })
    const result = mergeLists(
      {people: {[a]: person(a, {name: 'Anna'})}, topics: []},
      file
    )
    expect(result.lists.people[a]).toEqual(
      person(a, {name: 'Anna', muted: true})
    )
    expect(result.lists.people[b]).toEqual(person(b, {muted: true}))
    expect(result.added).toBe(1)
    expect(result.changed).toBe(1)
  })

  it('imports a version 2 file without hidden words', () => {
    expect(
      socialListsFromJson({
        version: 2,
        people: [{address: a, name: 'Anna', following: true, message: false}],
        topics: ['idena'],
      })
    ).toEqual({
      people: {[a]: person(a, {name: 'Anna', following: true})},
      topics: ['idena'],
      words: [],
      hiddenPosts: [],
      blockedTopics: [],
    })
  })

  it('adds blocks and hidden words on import', () => {
    const current = {
      people: {[a]: person(a, {name: 'Anna', following: true})},
      topics: [],
      words: ['spam'],
    }
    const imported = {
      people: {
        [a]: person(a, {blocked: true}),
        [b]: person(b, {blocked: true}),
      },
      topics: [],
      words: ['spam', 'scam'],
    }
    const result = mergeLists(current, imported)
    expect(result.lists.people[a]).toEqual(
      person(a, {name: 'Anna', following: true, blocked: true})
    )
    expect(result.lists.people[b]).toEqual(person(b, {blocked: true}))
    expect(result.lists.words).toEqual(['scam', 'spam'])
    expect(result.wordsAdded).toBe(1)
  })

  it('adds hidden posts and blocked topics on import', () => {
    const hash = `0x${'ab'.repeat(32)}`
    const other = `0x${'cd'.repeat(32)}`
    const result = mergeLists(
      {people: {}, topics: [], hiddenPosts: [hash]},
      {
        people: {},
        topics: [],
        hiddenPosts: [hash, other],
        blockedTopics: ['spam_topic'],
      }
    )
    expect(result.othersAdded).toBe(2)
    expect(result.lists.hiddenPosts).toEqual([hash, other])
    expect(result.lists.blockedTopics).toEqual(['spam_topic'])
    const file = socialListsFromJson({
      version: 3,
      people: [],
      hiddenPosts: ['0x1234', hash],
      blockedTopics: ['ok_name', 'r/x'],
    })
    expect(file.hiddenPosts).toEqual([hash])
    expect(file.blockedTopics).toEqual(['ok_name'])
  })

  it('leaves invalid hidden words out of a file', () => {
    expect(
      socialListsFromJson({
        version: 3,
        people: [],
        hiddenWords: ['spam', '   ', '  free   coins ', 7],
      }).words
    ).toEqual(['free coins', 'spam'])
  })

  it('keeps at most 300 hidden words on import', () => {
    const many = Array.from({length: 299}, (_, i) => `word${i}`)
    const result = mergeLists(
      {people: {}, topics: [], words: many},
      {people: {}, topics: [], words: ['new1', 'new2']}
    )
    expect(result.lists.words).toHaveLength(300)
    expect(result.wordsAdded).toBe(1)
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
      words: [],
      hiddenPosts: [],
      blockedTopics: [],
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
