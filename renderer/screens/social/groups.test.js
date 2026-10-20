import {keccak256Hex} from './keccak'
import {
  GROUP_GRACE_BLOCKS,
  KEY_LINE,
  MAX_GROUP_MEMBERS,
  acceptGroupKey,
  acceptGroupMessage,
  encryptGroupPart,
  groupConversationKey,
  groupEvent,
  groupKeyPlain,
  groupLines,
  groupMessageHash,
  groupMessagePlain,
  keyConversation,
  newGroupKey,
  previousKeyLines,
} from './groups'
import {
  conversations,
  parseMessageCall,
  plainMessage,
  readChatStore,
  readNewMessages,
  sendMessageArgument,
  emptyChatStore,
  unreadCount,
} from './messages'
import {visibleConversations} from './hiding'
import {person} from './people'
import {a, b, c, hex} from './test-helpers'

// Ported from the phone app's SocialGroupsTest.kt: the same format on both apps.

const d = '0xdddd000000000000000000000000000000000004'
const group = '0123456789abcdef0123456789abcdef'

/** A key message's call: one part per member (their text stands for the node's encryption). */
function keyCall(hash, height, from, members, hashOf = groupMessageHash) {
  const parts = members.map((m) => `part-for-${m}`)
  return {
    hash,
    height,
    time: height * 20,
    index: 0,
    from,
    parts,
    messageHash: hashOf(parts),
  }
}

function keyOf(
  hash,
  height,
  keyId,
  members,
  {key = newGroupKey(), admin = a, me = members[members.length - 1]} = {}
) {
  const plain = groupKeyPlain(admin, group, keyId, key, 'Family', members)
  return acceptGroupKey(
    keyCall(hash, height, admin, members),
    plain,
    [members.indexOf(me)],
    me
  )
}

async function groupCall(
  hash,
  height,
  from,
  key,
  text = 'hi',
  keyId = key.keyId
) {
  const parts = [
    await encryptGroupPart(
      groupMessagePlain(key.admin, key.group, keyId, text),
      key.key
    ),
  ]
  return {
    hash,
    height,
    time: height * 20,
    index: 0,
    from,
    parts,
    messageHash: groupMessageHash(parts),
  }
}

const opened = (indexes, message) => ({indexes, message})

describe('group chats with a shared key', () => {
  it('a key message is read by each member from their own part', () => {
    const members = [a, b, c]
    const key = newGroupKey()
    const plain = groupKeyPlain(a, group, 0, key, ' Family ', members)
    const call = keyCall('0xk', 10, a, members)
    const read = acceptGroupKey(call, plain, [1], b)
    expect(read.members).toEqual([a, b, c])
    expect(read.name).toBe('Family')
    expect(read.key).toBe(key)
    expect(keyConversation(read)).toBe(groupConversationKey(a, group))
    expect(JSON.parse(JSON.stringify(read))).toEqual(read)
    // The admin's own copy.
    expect(acceptGroupKey(call, plain, [0], a)).not.toBeNull()

    const refused = [
      // A hash of the text, as the website writes it.
      [
        keyCall('0xk', 10, a, members, () => keccak256Hex(plain)),
        plain,
        [1],
        b,
      ],
      // Sent by another than the admin.
      [keyCall('0xk', 10, c, members), plain, [1], b],
      // Not my part, two parts opened, not a member.
      [call, plain, [2], b],
      [call, plain, [1, 2], b],
      [call, plain, [1], d],
      // Parts and members differ.
      [keyCall('0xk', 10, a, [a, b]), plain, [1], b],
      // A member twice.
      [
        keyCall('0xk', 10, a, [a, b, b]),
        groupKeyPlain(a, group, 0, key, 'F', [a, b, b]),
        [1],
        b,
      ],
      // The admin not first.
      [call, groupKeyPlain(a, group, 0, key, 'F', [b, a, c]), [0], b],
      // A key of 3 bytes.
      [call, groupKeyPlain(a, group, 0, 'AAAA', 'F', members), [1], b],
      // idena.social's plain message.
      [call, plainMessage(a, [b, c], 'hi'), [1], b],
      // A key id that is not a whole number.
      [call, plain.replace('"keyId":0', '"keyId":"0"'), [1], b],
    ]
    refused.forEach(([one, text, indexes, me]) =>
      expect(acceptGroupKey(one, text, indexes, me)).toBeNull()
    )

    const many = [a].concat(
      Array.from(
        {length: MAX_GROUP_MEMBERS + 1},
        (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`
      )
    )
    expect(
      acceptGroupKey(
        keyCall('0xk', 10, a, many),
        groupKeyPlain(a, group, 0, key, 'F', many),
        [1],
        many[1]
      )
    ).toBeNull()
    const most = many.slice(0, -1)
    expect(
      acceptGroupKey(
        keyCall('0xk', 10, a, most),
        groupKeyPlain(a, group, 0, key, 'F', most),
        [1],
        most[1]
      )
    ).not.toBeNull()
  })

  it('a group message opens only with its key and from a member', async () => {
    const key = keyOf('0xk', 10, 0, [a, b, c])
    const message = await acceptGroupMessage(
      await groupCall('0xm', 11, b, key),
      key
    )
    expect(message.text).toBe('hi')
    expect(message.group).toBe(keyConversation(key))
    expect(message.participants).toEqual([a, b, c])

    const other = keyOf('0xk2', 10, 0, [a, b, c])
    expect(
      await acceptGroupMessage(await groupCall('0xm', 11, b, key), other)
    ).toBeNull()
    expect(
      await acceptGroupMessage(await groupCall('0xm', 11, d, key), key)
    ).toBeNull()
    expect(
      await acceptGroupMessage(await groupCall('0xm', 11, b, key, 'hi', 1), key)
    ).toBeNull()
    expect(
      await acceptGroupMessage(await groupCall('0xm', 11, b, key, ''), key)
    ).toBeNull()
    const call = await groupCall('0xm', 11, b, key)
    expect(
      await acceptGroupMessage({...call, messageHash: '0'.repeat(64)}, key)
    ).toBeNull()
    const twice = [...call.parts, ...call.parts]
    expect(
      await acceptGroupMessage(
        {...call, parts: twice, messageHash: groupMessageHash(twice)},
        key
      )
    ).toBeNull()
  })

  it('one part is kept by the scan, none is not', async () => {
    const part = await encryptGroupPart('x', newGroupKey())
    const arg = sendMessageArgument([part], groupMessageHash([part]))
    const raw = (text) => ({
      hash: '0xm',
      height: 1,
      timestamp: 20,
      index: 0,
      from: a,
      args: [hex(text)],
    })
    expect(parseMessageCall(raw(arg)).parts).toEqual([part])
    expect(
      parseMessageCall(raw(sendMessageArgument([], '0'.repeat(64))))
    ).toBeNull()
  })

  it('a removed member counts only within the grace after the change', async () => {
    const k0 = keyOf('0xk0', 100, 0, [a, b, c], {me: b})
    const k1 = keyOf('0xk1', 200, 1, [a, b], {me: b})
    const open = async (hash, height, from, key) =>
      acceptGroupMessage(await groupCall(hash, height, from, key), key)
    const before = await open('0xc1', 150, c, k0)
    const inGrace = await open('0xc2', 200 + GROUP_GRACE_BLOCKS, c, k0)
    const after = await open('0xc3', 201 + GROUP_GRACE_BLOCKS, c, k0)
    const fromB = await open('0xb1', 300, b, k1)
    const {lines, state} = groupLines([k1, k0], [after, fromB, inGrace, before])
    expect(lines.map(({hash}) => hash)).toEqual([
      '0xk0',
      '0xc1',
      '0xk1',
      '0xc2',
      '0xb1',
    ])
    expect(state.members).toEqual([a, b])
  })

  it('a key of another admin makes another group, an older key is ignored', () => {
    const k0 = keyOf('0xk0', 100, 0, [a, b, c], {me: b})
    const k2 = keyOf('0xk2', 110, 2, [a, b, c], {me: b})
    const older = keyOf('0xk1', 120, 1, [a, b], {me: b})
    const {lines, state} = groupLines([k0, k2, older], [])
    expect(lines.map(({hash}) => hash)).toEqual(['0xk0', '0xk2'])
    expect(state).toEqual(k2)
    // The same group id from another admin: their own group, never a change of this one.
    const forged = keyOf('0xkx', 130, 3, [c, b], {admin: c, me: b})
    const groups = conversations([], b, {}, [k0, k2, older, forged])
    expect(groups.map(({key, others}) => [key, others]).sort()).toEqual(
      [
        [keyConversation(k0), [a, c]],
        [keyConversation(forged), [c]],
      ].sort()
    )
  })

  it('a new key alone keeps the members and is a line of its own', () => {
    const k0 = keyOf('0xk0', 100, 0, [a, b, c], {me: b})
    const renewed = keyOf('0xk1', 110, 1, [a, b, c], {me: b})
    const [conversation] = conversations([], b, {}, [k0, renewed])
    expect(conversation.group).toEqual(renewed)
    expect(conversation.others).toEqual([a, c])
    const previous = previousKeyLines(conversation.messages)
    expect(previous[conversation.last.hash].hash).toBe('0xk0')
    expect(previous['0xk0']).toBeNull()
    expect(groupEvent(conversation.last, previous['0xk1'], b)).toEqual([
      {kind: 'newKey'},
    ])
    expect(groupEvent(conversation.messages[0], null, b)).toEqual([
      {kind: 'addedYou'},
    ])
    expect(groupEvent(conversation.messages[0], null, a)).toEqual([
      {kind: 'created'},
    ])
  })

  it('a change reads as who was added and removed, and a new name', () => {
    const k0 = keyOf('0xk0', 100, 0, [a, b, c], {me: b})
    const plain = groupKeyPlain(a, group, 1, newGroupKey(), 'Us', [a, b, d])
    const k1 = acceptGroupKey(keyCall('0xk1', 110, a, [a, b, d]), plain, [1], b)
    const {lines} = groupLines([k0, k1], [])
    expect(groupEvent(lines[1], lines[0], b)).toEqual([
      {kind: 'added', who: [d]},
      {kind: 'removed', who: [c]},
      {kind: 'renamed', name: 'Us'},
    ])
  })

  it('a message read before its key arrives is read with the key', async () => {
    const members = [a, b, c]
    const plain = groupKeyPlain(a, group, 0, newGroupKey(), 'Family', members)
    const kCall = keyCall('0xk', 10, a, members)
    const k = acceptGroupKey(kCall, plain, [1], b)
    const message = await groupCall('0xm', 12, c, k, 'early')
    let asked = 0
    const decrypt = async (chunk) => {
      asked += chunk.length
      return chunk.map((one) => (one === kCall ? opened([1], plain) : null))
    }
    // The message first, alone, while the account holds another group's key only: it does not open it yet.
    const another = keyOf('0xo', 5, 0, [c, b], {admin: c, me: b})
    let store = await readNewMessages(
      {...emptyChatStore(), groupKeys: [another]},
      [message],
      b,
      decrypt
    )
    expect(store.messages).toEqual([])
    // A one-part call never goes to the node.
    expect(asked).toBe(0)
    store = await readNewMessages(store, [message, kCall], b, decrypt)
    expect(store.messages.map(({text}) => text)).toEqual(['early'])
    expect(store.groupKeys).toHaveLength(2)
    expect(await readNewMessages(store, [message, kCall], b, decrypt)).toEqual(
      store
    )
    expect(readChatStore(JSON.parse(JSON.stringify(store)))).toEqual(store)

    const find = (people) =>
      conversations(store.messages, b, people, store.groupKeys).find(
        ({key}) => key === keyConversation(k)
      )
    const conversation = find({})
    expect(conversation.others).toEqual([a, c])
    expect(conversation.messages.map(({kind}) => kind ?? '')).toEqual([
      KEY_LINE,
      '',
    ])
    // A stranger's group waits in Requests; its admin marked to message takes it out.
    expect(conversation.isRequest).toBe(true)
    expect(find({[a]: person(a, {message: true})}).isRequest).toBe(false)
    // Being added counts as unread.
    expect(unreadCount(conversation, b, null)).toBe(2)
  })

  it('a blocked member is hidden in the group, a blocked admin hides it', async () => {
    const k = keyOf('0xk', 10, 0, [a, b, c], {me: b})
    const fromC = await acceptGroupMessage(await groupCall('0xc', 11, c, k), k)
    const fromA = await acceptGroupMessage(await groupCall('0xa', 12, a, k), k)
    const all = conversations([fromC, fromA], b, {}, [k])
    const [shown] = visibleConversations(all, new Set([c]))
    expect(shown.messages.map(({hash}) => hash)).toEqual(['0xk', '0xa'])
    expect(visibleConversations(all, new Set([a]))).toEqual([])
  })

  it('a store of the app before groups tries its failed calls again', async () => {
    const members = [a, b, c]
    const plain = groupKeyPlain(a, group, 0, newGroupKey(), 'Family', members)
    const kCall = keyCall('0xk', 10, a, members)
    const hi = plainMessage(a, [b], 'hi')
    const oneToOne = {
      hash: '0x1',
      height: 9,
      time: 180,
      index: 0,
      from: a,
      parts: ['p0', 'p1'],
      messageHash: keccak256Hex(hi),
    }
    const decrypt = async (chunk) =>
      chunk.map((one) => {
        if (one === kCall) return opened([1], plain)
        if (one === oneToOne) return opened([1], hi)
        return null
      })
    // As the app before groups saved it: both tried, the key message read as nothing.
    const read = await readNewMessages(emptyChatStore(), [oneToOne], b, decrypt)
    const old = {
      tried: [...read.tried, '0xk'],
      messages: read.messages,
      seen: {},
    }
    const store = readChatStore(JSON.parse(JSON.stringify(old)))
    expect(store.tried).toEqual(['0x1'])
    const next = await readNewMessages(store, [oneToOne, kCall], b, decrypt)
    expect(next.groupKeys.map(({hash}) => hash)).toEqual(['0xk'])
    // The message read once.
    expect(next.messages.map(({text}) => text)).toEqual(['hi'])
  })
})
