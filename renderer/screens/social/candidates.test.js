import {chatCandidates, claimableName} from './candidates'
import {conversationKey} from './messages'
import {person} from './people'

// Ported from the phone app's SocialNewChatTest.kt.

const me = '0x0000000000000000000000000000000000000001'
const alice = '0xaaaa000000000000000000000000000000000002'
const bob = '0xbbbb000000000000000000000000000000000003'
const carol = '0xcccc000000000000000000000000000000000004'
const dave = '0xdddd000000000000000000000000000000000005'

const people = {
  [alice]: person(alice, {name: 'Alice', following: true}),
  [bob]: person(bob, {name: 'Bob'}),
  [carol]: person(carol, {following: true}),
}

const chat = (...others) => ({
  key: conversationKey([...others, me]),
  others,
  messages: [],
  isGroup: others.length > 1,
  isRequest: false,
})

const find = (query, extra = {}) =>
  chatCandidates(query, {people, conversations: [], me, ...extra})

describe('who a new conversation can be with', () => {
  it('a blank query lists the latest conversations, then the people', () => {
    // dave is only in a conversation; carol is in one and in the list: once, at her conversation's place.
    const conversations = [chat(dave), chat(carol), chat(alice, bob)]
    expect(find('', {conversations})).toEqual([dave, carol, alice, bob])
  })

  it('a query matches a name or an address in any case', () => {
    expect(find('ALI')).toEqual([alice])
    expect(find('0xCCCC')).toEqual([carol])
    expect(find('zoe')).toEqual([])
  })

  it('a whole address typed comes first, even unknown', () => {
    const stranger = '0xEEEE000000000000000000000000000000000006'
    expect(find(`  ${stranger} `)).toEqual([stranger.toLowerCase()])
    expect(find(alice.toUpperCase().replace('0X', '0x'))).toEqual([alice])
  })

  it('never offers the account itself', () => {
    const withMe = {...people, [me]: person(me, {name: 'Me'})}
    expect(find(me, {people: withMe})).toEqual([])
    expect(find('', {people: withMe})).toEqual([alice, bob, carol])
  })

  it('finds an account known by its claimed name, not followed', () => {
    // frank is in no list and no conversation: only the profiles read name him.
    const frank = '0xffff000000000000000000000000000000000007'
    const known = {[frank]: '@frank', [alice]: '@alice_c'}
    expect(find('fra', {known})).toEqual([frank])
    expect(find('@Frank', {known})).toEqual([frank])
    // The People list's name still finds alice, once.
    expect(find('ali', {known})).toEqual([alice])
    // A blank query lists the conversations and the People list only, not every account known.
    expect(find('', {known})).toEqual([alice, bob, carol])
  })

  it('puts the holder of the name typed, or a message code, first', () => {
    const zed = '0x2222000000000000000000000000000000000008'
    expect(
      find('@zed', {found: zed.toUpperCase().replace('0X', '0x')})
    ).toEqual([zed])
    expect(find('@ali', {found: alice})).toEqual([alice])
    expect(find('@me', {found: me})).toEqual([])
  })

  it('reads a claimable name lowercase without its "@"', () => {
    expect(claimableName(' @Bob_1 ')).toBe('bob_1')
    expect(claimableName('frank')).toBe('frank')
    expect(claimableName('ab')).toBeNull()
    expect(claimableName('a b')).toBeNull()
    expect(claimableName(alice)).toBeNull()
  })
})
