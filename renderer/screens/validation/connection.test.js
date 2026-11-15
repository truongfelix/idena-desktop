import {State, createMachine, interpret} from 'xstate'
import {
  TX_LATE_SECONDS,
  afterSubmitStatus,
  answersTxHash,
  connectionLost,
  isInBlock,
  persistedLongAnswersTx,
  timeLeftText,
  txWaitState,
  validationAlert,
} from './connection'

jest.mock('../../shared/utils/utils', () => ({
  HASH_IN_MEMPOOL:
    '0x0000000000000000000000000000000000000000000000000000000000000000',
  callRpc: jest.fn(),
}))

const now = 1_800_000_000

describe('connectionLost', () => {
  it('waits for a second empty peer list', () => {
    expect(connectionLost({noPeerChecks: 0, isBehind: false})).toBe(false)
    expect(connectionLost({noPeerChecks: 1, isBehind: false})).toBe(false)
    expect(connectionLost({noPeerChecks: 2, isBehind: false})).toBe(true)
  })

  it('counts a node that says it is synced on an old head', () => {
    expect(connectionLost({noPeerChecks: 0, isBehind: true})).toBe(true)
  })

  it('leaves a node catching up with its peers to the syncing alert', () => {
    // The chain state's isBehind is false while bcn_syncing says syncing, whatever the head's age or the clock.
    expect(connectionLost({noPeerChecks: 0, isBehind: false})).toBe(false)
    expect(connectionLost({noPeerChecks: 0})).toBe(false)
  })
})

describe('isInBlock', () => {
  it('is false in the pool and for an unknown transaction', () => {
    expect(
      isInBlock({
        blockHash:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
      })
    ).toBe(false)
    expect(isInBlock(null)).toBe(false)
    expect(isInBlock({})).toBe(false)
    expect(isInBlock({blockHash: '0xabc'})).toBe(true)
  })
})

describe('txWaitState', () => {
  const ms = now * 1000
  it('is late once the wait passes its limit', () => {
    const sentAt = ms - TX_LATE_SECONDS * 1000
    expect(txWaitState({mined: false, sentAt, seenSince: ms, now: ms})).toBe(
      'waiting'
    )
    expect(
      txWaitState({mined: false, sentAt, seenSince: ms, now: ms + 1})
    ).toBe('late')
    expect(txWaitState({mined: true, sentAt, seenSince: ms, now: ms + 1})).toBe(
      'mined'
    )
  })

  it('counts from when the screen saw it without a send time', () => {
    const seenSince = ms - TX_LATE_SECONDS * 1000 - 1
    expect(txWaitState({mined: false, sentAt: null, seenSince, now: ms})).toBe(
      'late'
    )
    expect(
      txWaitState({mined: false, sentAt: undefined, seenSince: ms, now: ms})
    ).toBe('waiting')
  })
})

describe('afterSubmitStatus', () => {
  it('says submitted only once a block holds the answers', () => {
    expect(
      afterSubmitStatus({answersTx: 'waiting', connectionLost: false})
    ).toEqual({status: 'pending', warning: null})
    expect(
      afterSubmitStatus({answersTx: 'late', connectionLost: false})
    ).toEqual({status: 'pending', warning: 'late'})
    expect(
      afterSubmitStatus({answersTx: 'mined', connectionLost: true})
    ).toEqual({status: 'submitted', warning: null})
  })

  it('warns of a lost connection before a late transaction', () => {
    expect(
      afterSubmitStatus({answersTx: 'late', connectionLost: true})
    ).toEqual({status: 'pending', warning: 'noConnection'})
    expect(afterSubmitStatus({answersTx: null, connectionLost: true})).toEqual({
      status: 'sent',
      warning: 'noConnection',
    })
    expect(afterSubmitStatus({answersTx: null, connectionLost: false})).toEqual(
      {status: 'sent', warning: null}
    )
  })

  it('warns when the node does not answer at all', () => {
    expect(
      afterSubmitStatus({
        answersTx: 'waiting',
        connectionLost: false,
        offline: true,
      })
    ).toEqual({status: 'pending', warning: 'noConnection'})
    expect(
      afterSubmitStatus({
        answersTx: 'mined',
        connectionLost: false,
        offline: true,
      })
    ).toEqual({status: 'submitted', warning: null})
  })
})

describe('persistedLongAnswersTx', () => {
  it('reads the hash from a saved and restored validation', () => {
    const machine = createMachine({
      id: 'validation',
      predictableActionArguments: true,
      initial: 'done',
      context: {
        epoch: 7,
        submitLongAnswersHash: '0xlong',
        submitLongAnswersAt: 42,
      },
      states: {done: {}},
    })
    const service = interpret(machine).start()
    // What the page reads back: the saved definition made a State again.
    const restored = State.create(JSON.parse(JSON.stringify(service.state)))
    expect(persistedLongAnswersTx(restored, 7)).toEqual({
      hash: '0xlong',
      sentAt: 42,
    })
    // A validation saved in an earlier epoch is not this ceremony's.
    expect(persistedLongAnswersTx(restored, 8)).toEqual({
      hash: null,
      sentAt: null,
    })
    expect(persistedLongAnswersTx(undefined, 7)).toEqual({
      hash: null,
      sentAt: null,
    })
    service.stop()
  })
})

describe('timeLeftText', () => {
  const t = (key, values) =>
    key.replace(/{{(\w+)}}/g, (_, name) => String(values[name]))
  it('says the time left as the sidebar does', () => {
    expect(timeLeftText(t, 10 * 60000 + 20000, 0)).toBe('About 10 min left')
    expect(timeLeftText(t, 29000, 0)).toBe('Under a minute left')
    expect(timeLeftText(t, 0, 5000)).toBe('Under a minute left')
    expect(timeLeftText(t, 75 * 60000, 0)).toBe('About 1 h 15 min left')
  })
})

describe('validationAlert', () => {
  const base = {
    offline: false,
    syncing: false,
    connectionLost: false,
    shortAnswersTx: 'mined',
    inLongSession: true,
  }
  it('says no connection while the node calls itself syncing', () => {
    // A node with no peers answers bcn_syncing with syncing: true (devnet trial 2026-11-15).
    expect(
      validationAlert({...base, syncing: true, connectionLost: true})
    ).toBe('noConnection')
  })
  it('keeps offline first and the others in order', () => {
    expect(
      validationAlert({...base, offline: true, connectionLost: true})
    ).toBe('offline')
    expect(validationAlert({...base, syncing: true})).toBe('syncing')
    expect(validationAlert({...base, shortAnswersTx: 'late'})).toBe('shortLate')
    expect(
      validationAlert({...base, shortAnswersTx: 'late', inLongSession: false})
    ).toBe(null)
    expect(validationAlert(base)).toBe(null)
  })
})

describe('answersTxHash', () => {
  it('reads the hash the node returns as {txHash}', () => {
    // flip_submitLongAnswers answers {"txHash": "0x…"} (devnet trial 2026-11-15).
    expect(answersTxHash({txHash: '0xabc'})).toBe('0xabc')
    expect(answersTxHash('0xabc')).toBe('0xabc')
    expect(answersTxHash(null)).toBe(null)
    expect(answersTxHash({})).toBe(null)
    expect(answersTxHash('')).toBe(null)
  })
})
