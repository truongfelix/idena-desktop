import {DAY_BLOCKS, actionRules, lastActs, wroteFirst} from './rules'

const main = require('../../../../main/agent/criteria')

// B-281: once per author, and a private message only to who wrote first.
const ME = '0x34004a3ea52bd8c90daba56e400cfe9991b9b850'
const ANN = '0xa110000000000000000000000000000000000001'
const BOB = '0xb0b0000000000000000000000000000000000002'

const node = (id, author, height, more = {}) => ({
  id,
  call: {author, message: 'text', height},
  likeCalls: [],
  tips: [],
  replies: [],
  ...more,
})

const social = () => ({
  me: ME,
  feed: [
    node(1, ANN, 100, {
      likeCalls: [
        {author: ME, height: 5000},
        {author: BOB, height: 5001},
      ],
      tips: [{from: ME, height: 5100}],
      replies: [
        node(2, ME, 5200, {replies: [node(3, BOB, 5300)]}),
        node(4, BOB, 5400, {likeCalls: [{author: ME, height: 5500}]}),
      ],
    }),
  ],
  conversations: [
    {
      others: [BOB],
      messages: [
        {from: BOB, height: 4000},
        {from: ME, height: 6000},
      ],
    },
    {others: [ANN], messages: [{from: ME, height: 6100}]},
    {others: [ANN, BOB], isGroup: true, messages: [{from: ANN, height: 1}]},
  ],
})

describe('what the account did, from the chain', () => {
  test('its last reply, like, tip and message for each author', () => {
    const acts = lastActs(social())
    expect(acts.like.get(ANN)).toBe(5000)
    expect(acts.like.get(BOB)).toBe(5500)
    expect(acts.tip.get(ANN)).toBe(5100)
    expect(acts.reply.get(ANN)).toBe(5200)
    // Bob answered it: that is no reply of its own to Bob.
    expect(acts.reply.has(BOB)).toBe(false)
    expect(acts.message.get(BOB)).toBe(6000)
    expect(acts.message.get(ANN)).toBe(6100)
  })

  test('who wrote to it first: one to one only, and never one the account opened', () => {
    expect([...wroteFirst(social())]).toEqual([BOB])
    const opened = {
      me: ME,
      conversations: [
        {
          others: [ANN],
          messages: [
            {from: ME, height: 10},
            {from: ANN, height: 20},
          ],
        },
      ],
    }
    expect([...wroteFirst(opened)]).toEqual([])
  })
})

describe('the rules of a run', () => {
  test('once per author: a day or a week of blocks back, per action', () => {
    const rows = {like: {perAuthor: 'day'}, tip: {perAuthor: 'week'}, reply: {}}
    const soon = actionRules(rows, social(), 5000 + DAY_BLOCKS - 1)
    expect(soon.allows('like', [ANN])).toBe('once per author')
    const later = actionRules(rows, social(), 5000 + DAY_BLOCKS)
    expect(later.allows('like', [ANN])).toBeNull()
    // Bob's like is newer.
    expect(later.allows('like', [BOB])).toBe('once per author')
    expect(later.allows('tip', [ANN])).toBe('once per author')
    expect(
      actionRules(rows, social(), 5100 + 7 * DAY_BLOCKS).allows('tip', [ANN])
    ).toBeNull()
    // No rule on replies.
    expect(soon.allows('reply', [ANN])).toBeNull()
  })

  test('what the run already asked for counts, for that action only', () => {
    const rules = actionRules({like: {perAuthor: 'day'}, tip: {}}, {me: ME}, 9)
    expect(rules.allows('like', [ANN])).toBeNull()
    rules.did('like', [ANN])
    expect(rules.allows('like', [ANN.toUpperCase().replace('0X', '0x')])).toBe(
      'once per author'
    )
    expect(rules.allows('like', [BOB])).toBeNull()
    rules.did('tip', [BOB])
    expect(rules.allows('tip', [BOB])).toBeNull()
  })

  test('what waits in To approve from an earlier run counts for its author', () => {
    const rules = actionRules({tip: {perAuthor: 'week'}}, {me: ME}, 9, [
      {action: 'tip', whom: [ANN]},
      {action: 'like', whom: [BOB]},
    ])
    expect(rules.allows('tip', [ANN])).toBe('once per author')
    expect(rules.allows('tip', [BOB])).toBeNull()
  })

  test('what the agent did, as the main process noted it, counts before the chain shows it', () => {
    const noted = [
      {action: 'tip', who: ANN, height: 100},
      {action: 'tip', who: BOB, height: 100 - 8 * DAY_BLOCKS},
    ]
    const rules = actionRules(
      {tip: {perAuthor: 'week'}, like: {perAuthor: 'day'}},
      {me: ME},
      120,
      [],
      noted
    )
    expect(rules.allows('tip', [ANN])).toBe('once per author')
    // Older than the period, and another action: no.
    expect(rules.allows('tip', [BOB])).toBeNull()
    expect(rules.allows('like', [ANN])).toBeNull()
  })

  test('a message only to who wrote first, when the row asks for it', () => {
    const strict = actionRules({message: {onlyAnswers: true}}, social(), 9000)
    expect(strict.allows('message', [BOB])).toBeNull()
    expect(strict.allows('message', [ANN])).toBe('did not write first')
    expect(
      actionRules({message: {}}, social(), 9000).allows('message', [ANN])
    ).toBeNull()
  })
})

describe('the rules as the main process keeps them', () => {
  test('each kept only when set, and only on the actions that have it', () => {
    expect(main.criteriaField('like', {perAuthor: 'week'})).toEqual({
      perAuthor: 'week',
    })
    expect(main.criteriaField('like', {perAuthor: 'hour'})).toEqual({})
    expect(main.criteriaField('like', {onlyAnswers: true})).toEqual({})
    expect(main.criteriaField('message', {onlyAnswers: true})).toEqual({
      onlyAnswers: true,
    })
    expect(main.criteriaField('post', {perAuthor: 'day'})).toEqual({})
  })

  test('a profile name and topics: read back as saved, a topic checked', () => {
    expect(
      main.normalizeCriteria(
        {named: true, topics: ['Flips', 'r/validation', 'no', 'bad name']},
        {withWords: true}
      )
    ).toMatchObject({named: true, topics: ['flips', 'validation']})
    // Topics are for a read; criteria saved before hold neither field.
    expect(main.normalizeCriteria({topics: ['flips']})).toBeNull()
    const before = main.normalizeCriteria({states: ['Human']})
    expect('named' in before).toBe(false)
    expect('topics' in before).toBe(false)
  })
})
