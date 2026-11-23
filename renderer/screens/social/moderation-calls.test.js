import {MODERATION_CONTRACT, emptyModeration} from './moderation'
import {
  DEFAULT_CALLBACK_GAS,
  MIN_CALLBACK_GAS,
  ModerationCall,
  canVouchMore,
  moderatorRefusal,
  moderatorRole,
  ownReport,
  reasonBytes,
  reportRefusal,
  withSizedCallbacks,
} from './moderation-calls'
import {a, b, c} from './test-helpers'
import {moderationKey} from './sending'

const banned = (state, address, extra = {}) => {
  state.bans.set(address, {
    permanent: true,
    endEpoch: 0,
    reason: '',
    since: {time: 0, height: 0, index: 0},
    ...extra,
  })
  return state
}

describe('the moderation calls', () => {
  it('are the contract methods, one JSON argument, no iDNA', () => {
    expect(ModerationCall.reportPost(`0X${'AB'.repeat(32)}`, 'Spam')).toEqual({
      contract: MODERATION_CONTRACT,
      method: 'reportTransaction',
      argument: JSON.stringify({hash: `0x${'ab'.repeat(32)}`, reason: 'Spam'}),
      amount: '0',
    })
    expect(JSON.parse(ModerationCall.ban(a, 0, '').argument)).toEqual({
      address: a,
      epochs: 0,
      reason: '',
    })
    expect(ModerationCall.hidePosts(['0x01', '02'], 'x').method).toBe(
      'banTransactions'
    )
  })

  it('size the callbacks from the dry run', () => {
    const call = ModerationCall.ban(a, 0, '')
    const receipt = (...used) => ({
      actionResult: {
        subActionResults: used.map((gasUsed) => ({
          inputAction: {actionType: 1, method: '_banCheckTarget'},
          gasUsed,
          subActionResults: [],
        })),
      },
    })
    expect(withSizedCallbacks(call, {actionResult: {}})).toBe(call)
    expect(
      JSON.parse(withSizedCallbacks(call, receipt(500000, 400000)).argument)
        ._gasLimit
    ).toBe(1500000)
    expect(
      JSON.parse(withSizedCallbacks(call, receipt(10)).argument)._gasLimit
    ).toBe(MIN_CALLBACK_GAS)
    expect(
      JSON.parse(withSizedCallbacks(call, receipt(9000000)).argument)._gasLimit
    ).toBe(DEFAULT_CALLBACK_GAS)
  })
})

describe('a report', () => {
  it('counts its reason in UTF-8 bytes', () => {
    expect(reasonBytes('é🙂')).toBe(6)
  })

  it('is refused before it is signed', () => {
    const state = emptyModeration()
    const ok = {address: b, reason: 'Spam'}
    expect(reportRefusal(state, 240, a, ok)).toBeNull()
    expect(reportRefusal(state, 240, null, ok)).toBe('noAccount')
    expect(reportRefusal(state, 240, a, {address: a, reason: 'x'})).toBe('self')
    expect(reportRefusal(state, 240, a, {address: b, reason: '  '})).toBe(
      'noReason'
    )
    expect(
      reportRefusal(state, 240, a, {address: b, reason: 'x'.repeat(281)})
    ).toBe('tooLong')
    expect(reportRefusal(banned(emptyModeration(), b), 240, a, ok)).toBe(
      'alreadyBanned'
    )
    expect(reportRefusal(banned(emptyModeration(), a), 240, a, ok)).toBe(
      'banned'
    )
  })

  it('made before shows instead: the last one of the reporter', () => {
    const state = emptyModeration()
    state.reports.push(
      {target: b, reporter: a, reason: 'one', time: 1},
      {target: b, reporter: c, reason: 'other', time: 2},
      {target: b, reporter: a, reason: 'two', time: 3}
    )
    expect(ownReport(state, a, b).reason).toBe('two')
    expect(ownReport(state, b, a)).toBeNull()
  })
})

describe('a moderator', () => {
  it('is a staker, or vouched for, and never while banned', () => {
    const state = emptyModeration()
    expect(moderatorRole(state, 240, a, '1000000', 1000000)).toBe('staker')
    expect(moderatorRole(state, 240, a, '999999.9', 1000000)).toBeNull()
    state.vouchers.set(b, new Set([a]))
    expect(moderatorRole(state, 240, b, '0', 1000000)).toBe('vouched')
    banned(state, b)
    expect(moderatorRole(state, 240, b, '0', 1000000)).toBeNull()
  })

  it('cannot ban a moderator, nor beyond the limits', () => {
    const state = emptyModeration()
    const refusal = (opts, role = 'staker') =>
      moderatorRefusal(state, 240, a, role, opts)
    expect(refusal({address: b})).toBeNull()
    expect(refusal({address: b}, null)).toBe('notModerator')
    expect(refusal({address: a})).toBe('self')
    expect(refusal({address: b, targetRole: 'staker'})).toBe('targetStaker')
    expect(refusal({address: b, targetRole: 'vouched'})).toBe('targetVouched')
    expect(refusal({address: b, epochs: 65536})).toBe('epochs')
    expect(refusal({count: 101})).toBe('batch')
  })

  it('vouches for at most five', () => {
    const state = emptyModeration()
    for (let i = 0; i < 5; i += 1)
      state.vouchers.set(`0x${String(i).repeat(40)}`, new Set([a]))
    expect(canVouchMore(state, a)).toBe(false)
    expect(canVouchMore(state, b)).toBe(true)
  })
})

describe('a moderation action waiting for its block', () => {
  it('is keyed by its target, whatever its reason or gas', () => {
    const ban = ModerationCall.ban(a, 1, 'Spam')
    expect(moderationKey(ModerationCall.ban(a, 4, 'Scam'))).toBe(
      moderationKey(ban)
    )
    expect(moderationKey(withSizedCallbacks(ban, {actionResult: {}}))).toBe(
      moderationKey(ban)
    )
    expect(moderationKey(ModerationCall.ban(b, 1, 'Spam'))).not.toBe(
      moderationKey(ban)
    )
    expect(moderationKey(ModerationCall.unban(a, ''))).not.toBe(
      moderationKey(ban)
    )
    expect(moderationKey(ModerationCall.hidePosts(['0x02', '0x01'], 'x'))).toBe(
      moderationKey(ModerationCall.hidePosts(['0x01', '0x02'], 'y'))
    )
  })
})
