import {
  IMPORT_REQUEST_TIMEOUT_MS,
  createImportAttempts,
  importKeyErrorText,
  importKeyWhenReady,
} from './import-key'

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

  it('reports an HTTP error the node answered, without waiting', async () => {
    const badRequest = Object.assign(
      new Error('Request failed with status code 400'),
      {response: {status: 400}}
    )
    const {importKey} = nodeAnswering(badRequest, IMPORTED)

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', fakeTime())

    expect(result).toEqual({
      ok: false,
      reason: 'node',
      detail: 'Request failed with status code 400',
    })
    expect(importKey).toHaveBeenCalledTimes(1)
  })

  it('bounds each call, and retries one that timed out', async () => {
    const timedOut = Object.assign(new Error('timeout of 20000ms exceeded'), {
      code: 'ECONNABORTED',
    })
    const {importKey} = nodeAnswering(timedOut, IMPORTED)

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', fakeTime())

    expect(result).toEqual({ok: true})
    expect(importKey.mock.calls).toEqual([
      ['abc', 'pw', {timeout: IMPORT_REQUEST_TIMEOUT_MS}],
      ['abc', 'pw', {timeout: IMPORT_REQUEST_TIMEOUT_MS}],
    ])
  })

  it('drops an answer that comes after the dialog closed', async () => {
    let closed = false
    const importKey = jest.fn(async () => {
      closed = true // the user closes the dialog while the call is out
      return WRONG_PASSWORD
    })

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', {
      ...fakeTime(),
      isCancelled: () => closed,
    })

    expect(result).toEqual({ok: false, reason: 'cancelled'})
  })

  it('answers at once when the built-in node failed to start', async () => {
    const {importKey} = nodeAnswering(new Error('Network Error'), IMPORTED)
    let failed = false

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', {
      ...fakeTime(),
      onWaiting: () => {
        failed = true
      },
      isNodeFailed: () => failed,
    })

    expect(result).toEqual({ok: false, reason: 'node-failed'})
    expect(importKey).toHaveBeenCalledTimes(1)
    expect(importKeyErrorText(result, t)).toBe(
      'The built-in node failed to start. Use Try restart in Settings > Node, then import the key.'
    )
  })

  it('says the node refused when its refusal has no text', async () => {
    const {importKey} = nodeAnswering({error: {code: -32000}})

    const result = await importKeyWhenReady(importKey, 'abc', 'pw', fakeTime())

    expect(importKeyErrorText(result, t)).toBe(
      'The node did not import the key.'
    )
  })
})

describe('one import at a time', () => {
  // The dialog's own use: the attempt's end is the loop's cancel.
  const run = (attempt, importKey, during) =>
    importKeyWhenReady(importKey, 'abc', 'pw', {
      ...fakeTime(),
      onWaiting: during,
      isCancelled: () => !attempt.isCurrent(),
    })

  it('ends the waiting import when the dialog is closed and opened again', async () => {
    const attempts = createImportAttempts()
    const {importKey} = nodeAnswering(NOT_SERVED, IMPORTED)
    const first = attempts.start()

    const result = await run(first, importKey, () => {
      attempts.endAll() // closed
      attempts.start() // opened again, Import clicked with another key
    })

    expect(result).toEqual({ok: false, reason: 'cancelled'})
    expect(importKey).toHaveBeenCalledTimes(1)
  })

  it('ends the waiting import when the page is left', async () => {
    const attempts = createImportAttempts()
    const {importKey} = nodeAnswering(NOT_SERVED, IMPORTED)

    const result = await run(attempts.start(), importKey, () =>
      attempts.endAll()
    )

    expect(result).toEqual({ok: false, reason: 'cancelled'})
    expect(importKey).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest import going', async () => {
    const attempts = createImportAttempts()
    attempts.start()
    const latest = attempts.start()
    const {importKey} = nodeAnswering(NOT_SERVED, IMPORTED)

    expect(await run(latest, importKey, () => {})).toEqual({ok: true})
  })
})
