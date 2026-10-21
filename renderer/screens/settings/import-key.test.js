import {importKeyErrorText, importKeyWhenReady} from './import-key'

// Interpolates as i18next does, so that the lines read as the user sees them in English.
const t = (key, values = {}) =>
  key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]))

// The node's answers, as idena-go gives them.
const NOT_SERVED = {
  error: {
    code: -32601,
    message: 'The method dna_importKey does not exist/is not available',
  },
}
const WRONG_PASSWORD = {
  error: {
    code: -32000,
    message: 'error while decrypting key: invalid encrypted payload',
  },
}
const NOT_HEX = {
  error: {
    code: -32000,
    message:
      "error while decoding key, err: encoding/hex: invalid byte: U+0078 'x'",
  },
}
const IMPORTED = {}

// A node that answers each call with the next answer; a thrown answer is a node it cannot reach.
function nodeAnswering(...answers) {
  const calls = []
  const importKey = jest.fn(async (key, password) => {
    calls.push([key, password])
    const answer = answers[Math.min(calls.length, answers.length) - 1]
    if (answer instanceof Error) throw answer
    return answer
  })
  return {importKey, calls}
}

// A clock that moves only when the helper sleeps.
function fakeTime() {
  let ms = 0
  return {
    now: () => ms,
    sleep: async (wait) => {
      ms += wait
    },
  }
}

describe('importing a key', () => {
  it('waits while the node serves only its start-up methods, then imports', async () => {
    const {importKey, calls} = nodeAnswering(NOT_SERVED, NOT_SERVED, IMPORTED)
    const onWaiting = jest.fn()

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', {
      ...fakeTime(),
      onWaiting,
    })

    expect(result).toEqual({ok: true})
    expect(calls).toEqual([
      ['abc', 'pw'],
      ['abc', 'pw'],
      ['abc', 'pw'],
    ])
    expect(onWaiting).toHaveBeenCalledTimes(2)
  })

  it('waits while the built-in node restarts and cannot be reached', async () => {
    const {importKey} = nodeAnswering(new Error('Network Error'), IMPORTED)

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', fakeTime())

    expect(result).toEqual({ok: true})
    expect(importKey).toHaveBeenCalledTimes(2)
  })

  it('does not retry a wrong password, and says it in plain words', async () => {
    const {importKey} = nodeAnswering(WRONG_PASSWORD, IMPORTED)

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', fakeTime())

    expect(result).toEqual({ok: false, reason: 'password'})
    expect(importKey).toHaveBeenCalledTimes(1)
    expect(importKeyErrorText(result, t)).toBe(
      'The password does not open this key. Check the password the key was exported with.'
    )
  })

  it('tells a pasted text that is no exported key', async () => {
    const {importKey} = nodeAnswering(NOT_HEX)

    const result = await importKeyWhenReady(importKey, 'xyz', 'pw', fakeTime())

    expect(importKeyErrorText(result, t)).toBe(
      'This is not an exported Idena key. Paste the whole key, as Export gave it.'
    )
  })

  it('gives up once the node has not finished starting in time', async () => {
    const {importKey} = nodeAnswering(NOT_SERVED)

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', {
      ...fakeTime(),
      waitMs: 60000,
      retryMs: 2000,
    })

    expect(result).toEqual({ok: false, reason: 'not-ready'})
    // Tried at 0, 2, …, 60 s: the last try at the deadline.
    expect(importKey).toHaveBeenCalledTimes(31)
    expect(importKeyErrorText(result, t)).toBe(
      'The node did not finish starting. Try again once it is synchronized.'
    )
  })

  it('stops waiting once the dialog is closed', async () => {
    const {importKey} = nodeAnswering(NOT_SERVED, IMPORTED)
    let closed = false

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', {
      ...fakeTime(),
      onWaiting: () => {
        closed = true
      },
      isCancelled: () => closed,
    })

    expect(result).toEqual({ok: false, reason: 'cancelled'})
    expect(importKey).toHaveBeenCalledTimes(1)
  })

  it('names any other refusal of the node after a translated line', async () => {
    const {importKey} = nodeAnswering({
      error: {message: 'failed to reserve key backup, err: disk full'},
    })

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', fakeTime())

    expect(importKeyErrorText(result, t)).toBe(
      'The node did not import the key: failed to reserve key backup, err: disk full'
    )
  })
})
