import {
  MAX_NAME,
  cleanName,
  displayName,
  followingFeed,
  mergePeople,
  peopleFromJson,
  peopleNames,
  peopleToJson,
  person,
  searchSocial,
  shortAddress,
  sortedPeople,
  withPerson,
} from './people'
import {
  ActivityKind,
  countNotices,
  newActivity,
  NotifyKind,
  socialActivity,
} from './activity'
import {LIKE} from './contract'
import {commentTree, descendants, socialFeed, treeContains} from './feed'
import {identityColor, identityLabel} from './format'

// Ported from the phone app's PeopleTest.kt, SocialTest.kt and ThreadTreeTest.kt.

const a = '0xaaaa000000000000000000000000000000000001'
const b = '0xbbbb000000000000000000000000000000000002'
const c = '0xcccc000000000000000000000000000000000003'

const call = (
  hash,
  author,
  message,
  time,
  {replyTo = '', channel = '', height = time} = {}
) => ({
  hash,
  height,
  time,
  index: 0,
  author,
  message,
  replyTo,
  channel,
  hasMedia: false,
  media: '',
  mediaType: '',
})

const node = (id, postCall, replies = []) => ({
  id,
  call: postCall,
  likeCalls: [],
  tips: [],
  replies,
})

describe('contacts', () => {
  it('leave the list without name or mark', () => {
    let people = {}
    people = withPerson(people, person(a, {name: 'Alice'}))
    people = withPerson(people, person(b, {following: true}))
    expect(Object.keys(people).sort()).toEqual([a, b])
    people = withPerson(people, person(a))
    expect(Object.keys(people)).toEqual([b])
  })

  it('have one trimmed line as a name', () => {
    expect(cleanName('  Alice\n\tSmith  ')).toBe('Alice Smith')
    expect(cleanName('x'.repeat(100))).toHaveLength(MAX_NAME)
    // An emoji (2 UTF-16 units) across the limit is dropped whole, never cut in half.
    expect(cleanName(`${'x'.repeat(MAX_NAME - 1)}😀`)).toBe(
      'x'.repeat(MAX_NAME - 1)
    )
    expect(cleanName('ok 😀')).toBe('ok 😀')
    expect(cleanName(' \n ')).toBe('')
    expect(cleanName(undefined)).toBe('')
  })

  it('keep the list through its JSON and drop bad entries', () => {
    const people = {
      [a]: person(a, {name: 'Alice', following: true}),
      [b]: person(b, {message: true}),
    }
    const json = peopleToJson(people)
    expect(json.version).toBe(1)
    json.people.push({address: 'not an address', name: 'x'})
    json.people.push({address: c})
    expect(peopleFromJson(JSON.parse(JSON.stringify(json)))).toEqual(people)
    expect(peopleFromJson({})).toEqual({})
    expect(peopleFromJson(null)).toEqual({})
  })

  it('read a phone export', () => {
    // As the phone app writes files/social/people.json and its export.
    const exported = {
      version: 1,
      people: [
        {
          address: a.toUpperCase().replace('0X', '0x'),
          name: 'Alice',
          following: true,
          message: false,
        },
      ],
    }
    expect(peopleFromJson(exported)).toEqual({
      [a]: person(a, {name: 'Alice', following: true}),
    })
  })

  it('come named first, in name order', () => {
    const people = {
      [a]: person(a, {name: 'zed'}),
      [b]: person(b, {name: 'Bob'}),
      [c]: person(c, {following: true}),
    }
    expect(sortedPeople(people).map(({address}) => address)).toEqual([b, a, c])
  })

  it('give their name, else the short address', () => {
    const names = peopleNames({
      [a]: person(a, {name: 'Alice'}),
      [b]: person(b, {following: true}),
    })
    expect(displayName(a.toUpperCase().replace('0X', '0x'), names)).toBe(
      'Alice'
    )
    expect(displayName(b, names)).toBe(shortAddress(b))
    expect(shortAddress(b)).toBe('0xbbbb…0002')
  })

  it('keep the followed authors for Following', () => {
    const feed = [
      node(2, call('p2', b, 'two', 20)),
      node(1, call('p1', a, 'one', 10)),
    ]
    expect(
      followingFeed(feed, {
        [a]: person(a, {following: true}),
        [b]: person(b, {name: 'Bob'}),
      }).map(({id}) => id)
    ).toEqual([1])
  })

  it('merge an import without losing anything', () => {
    const current = {
      [a]: person(a, {name: 'Alice', message: true}),
      [b]: person(b, {name: 'Bob'}),
    }
    const file = {
      [a]: person(a, {following: true}),
      [b]: person(b, {name: 'Robert'}),
      [c]: person(c, {name: 'Carol'}),
    }
    const result = mergePeople(current, file)
    expect(result.added).toBe(1)
    expect(result.changed).toBe(2)
    expect(result.people[a]).toEqual(
      person(a, {name: 'Alice', following: true, message: true})
    )
    expect(result.people[b].name).toBe('Robert')
    const again = mergePeople(result.people, file)
    expect(again.added + again.changed).toBe(0)
  })
})

describe('the search', () => {
  it('finds the address, the contacts and the texts', () => {
    const comment = node(5, call('c5', c, 'Hello from a comment', 30))
    const feed = [
      node(3, call('p3', b, 'ipfs://bafkreitext1234', 25)),
      node(1, call('p1', a, 'hello world', 10), [
        node(2, call('r2', b, 'no match', 20), [comment]),
      ]),
    ]
    const people = {
      [a]: person(a, {name: 'Helloise'}),
      [b]: person(b, {name: 'Bob'}),
    }
    const ipfs = {bafkreitext1234: 'hello on IPFS'}

    const hits = searchSocial(feed, people, 'hello', (cid) => ipfs[cid])
    expect(hits[0]).toEqual({kind: 'person', person: people[a]})
    expect(hits.slice(1).map((hit) => hit.node.id)).toEqual([5, 3, 1])
    expect(hits[1].threadId).toBe(1)
    expect(searchSocial(feed, {}, 'hello').map((hit) => hit.node.id)).toEqual([
      5, 1,
    ])
    expect(
      searchSocial(feed, people, a.toUpperCase().replace('0X', '0x'))[0]
    ).toEqual({
      kind: 'address',
      address: a,
    })
    expect(searchSocial(feed, people, '0xbbbb')).toEqual([
      {kind: 'person', person: people[b]},
    ])
    expect(searchSocial(feed, people, 'h')).toEqual([])
  })
})

describe('the identity colors', () => {
  it('follow the phone app', () => {
    expect(identityColor('Human')).toBe('#B8860B')
    expect(identityColor('Verified')).toBe('#1565C0')
    expect(identityColor('Newbie')).toBe('#2E7D32')
    expect(identityColor('Undefined')).toBeNull()
    expect(identityLabel('Human', 12)).toBe('Human · age 12')
    expect(identityLabel('Candidate', 0)).toBe('Candidate')
    expect(identityLabel('Undefined', 3)).toBe('Not validated')
  })
})

const tip = (hash, from, postId, amount, height) => ({
  hash,
  height,
  time: height,
  index: 0,
  from,
  postId,
  tipAmount: amount,
  amount,
})

describe('the inbox', () => {
  it('lists what others did on my posts', () => {
    const posts = [
      call('p1', a, 'my post', 100),
      call('p2', b, 'a reply to me', 110, {replyTo: '1'}),
      call('p3', c, LIKE, 120, {replyTo: '1'}),
      call('p4', a, LIKE, 125, {replyTo: '1'}),
      call('p5', a, 'my reply to b', 130, {replyTo: '1'}),
      call('p6', c, 'comment on my reply', 140, {
        replyTo: '5',
        channel: 'discuss:5',
      }),
      call('p7', a, 'my comment', 150, {replyTo: '2', channel: 'discuss:2'}),
      call('p8', b, 'answer to my comment', 160, {
        replyTo: '7',
        channel: 'discuss:2',
      }),
      call('p9', b, "someone else's post", 170),
    ]
    const authors = Object.fromEntries(posts.map((p, i) => [i + 1, p.author]))
    const tips = [tip('t1', c, '5', '2', 180), tip('t2', a, '9', '1', 190)]
    const items = socialActivity(socialFeed(posts, authors, tips), a)
    expect(items.map(({kind, actor}) => [kind, actor])).toEqual([
      [ActivityKind.Tip, c],
      [ActivityKind.Comment, b],
      [ActivityKind.Comment, c],
      [ActivityKind.Like, c],
      [ActivityKind.Reply, b],
    ])
    expect(items[0].amount).toBe(2)
    expect(items[0].what.message).toBe('my reply to b')
    expect(new Set(items.map(({threadId}) => threadId))).toEqual(new Set([1]))
    expect(items.map(({focusId}) => focusId)).toEqual([5, 8, 6, 1, 2])
  })

  it('counts as new the activity of the kinds on after the block seen', () => {
    const item = (kind, height) => ({kind, height})
    const items = [
      item(ActivityKind.Tip, 300),
      item(ActivityKind.Comment, 250),
      item(ActivityKind.Like, 200),
      item(ActivityKind.Reply, 150),
    ]
    const all = Object.values(NotifyKind)
    expect(newActivity(items, 200, all).map(({height}) => height)).toEqual([
      300, 250,
    ])
    expect(
      newActivity(items, 100, [NotifyKind.Likes, NotifyKind.Comments]).map(
        ({height}) => height
      )
    ).toEqual([250, 200, 150])
    expect(newActivity(items, 0, [])).toEqual([])
    expect(newActivity(items, 300, all)).toEqual([])
    expect(countNotices(items)).toEqual({likes: 1, comments: 2, tips: 1})
  })
})

describe('the comment tree', () => {
  const comment = (id, replyTo) =>
    node(
      id,
      call(`0x${id}`, '0xa', `text ${id}`, id, {
        replyTo: String(replyTo),
        channel: 'discuss:10',
      })
    )

  it('nests the comments under what they answer', () => {
    // Reply 10: 11 and 14 answer it, 12 answers 11, 13 answers 12, 15 answers an unknown comment.
    const tree = commentTree(10, [
      comment(11, 10),
      comment(12, 11),
      comment(13, 12),
      comment(14, 10),
      comment(15, 99),
    ])
    expect(tree.map(({comment: c2}) => c2.id)).toEqual([11, 14, 15])
    expect(tree[0].children.map(({comment: c2}) => c2.id)).toEqual([12])
    expect(tree[0].children[0].children.map(({comment: c2}) => c2.id)).toEqual([
      13,
    ])
    expect(descendants(tree[0])).toBe(2)
    expect(descendants(tree[1])).toBe(0)
    expect(treeContains(tree[0], 13)).toBe(true)
    expect(treeContains(tree[0], 14)).toBe(false)
  })

  it('still shows every comment of a loop', () => {
    const tree = commentTree(10, [
      comment(11, 12),
      comment(12, 11),
      comment(13, 13),
    ])
    const shown = tree.flatMap((n) => [
      n.comment.id,
      ...n.children.map((k) => k.comment.id),
    ])
    expect(new Set(shown)).toEqual(new Set([11, 12, 13]))
    expect(tree.length + tree.reduce((sum, n) => sum + descendants(n), 0)).toBe(
      3
    )
  })
})
