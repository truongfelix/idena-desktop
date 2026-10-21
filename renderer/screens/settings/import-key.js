// Imports a node key through dna_importKey, waiting for the node's full RPC.
// For its first seconds (minutes after a long sync or a DB compaction) the node serves only `bcn`, and
// every other method answers "The method … does not exist/is not available"; while the built-in node
// restarts, the call gets no answer at all. Both are retried until the node answers or the time is up.

export const IMPORT_WAIT_MS = 5 * 60 * 1000
export const IMPORT_RETRY_MS = 2000
// A node that takes the connection and never answers counts as one that cannot be reached.
export const IMPORT_REQUEST_TIMEOUT_MS = 20000

const NOT_SERVED_YET = /does not exist\/is not available/i

function isNodeStarting(error) {
  return NOT_SERVED_YET.test(error?.message ?? '')
}

// No HTTP answer at all (connection refused, reset, timed out): the node is not up yet.
// An HTTP answer that is an error (a refused request, a server error) is the node's last word.
function isUnreachable(thrown) {
  return !thrown?.response
}

/**
 * @returns {Promise<{ok: true} | {ok: false, reason: string, detail?: string}>}
 * reason: 'password', 'format', 'not-ready', 'node-failed', 'cancelled' or 'node' (detail: the node's text)
 */
export async function importKeyWhenReady(
  importKey,
  key,
  password,
  {
    waitMs = IMPORT_WAIT_MS,
    retryMs = IMPORT_RETRY_MS,
    requestTimeoutMs = IMPORT_REQUEST_TIMEOUT_MS,
    now = () => Date.now(),
    sleep = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    onWaiting = () => {},
    isCancelled = () => false,
    isNodeFailed = () => false,
  } = {}
) {
  const deadline = now() + waitMs
  for (;;) {
    if (isCancelled()) return {ok: false, reason: 'cancelled'}
    if (isNodeFailed()) return {ok: false, reason: 'node-failed'}
    let error
    let unreachable = false
    try {
      // eslint-disable-next-line no-await-in-loop
      ;({error} = await importKey(key, password, {timeout: requestTimeoutMs}))
    } catch (thrown) {
      if (isUnreachable(thrown)) unreachable = true
      else error = thrown
    }
    // An answer that comes after the dialog closed is dropped, an import included: the dialog
    // that would restart the node with it is gone.
    if (isCancelled()) return {ok: false, reason: 'cancelled'}
    if (!unreachable && !error) return {ok: true}
    if (!unreachable && !isNodeStarting(error)) return nodeRefusal(error)
    if (now() + retryMs > deadline) return {ok: false, reason: 'not-ready'}
    onWaiting()
    // eslint-disable-next-line no-await-in-loop
    await sleep(retryMs)
  }
}

// The node's texts (idena-go config.ProvideNodeKey), in plain words for the dialog.
function nodeRefusal(error) {
  const message = (error?.message ?? '').trim()
  if (/error while decrypting key/i.test(message))
    return {ok: false, reason: 'password'}
  if (/error while decoding key|is not valid ECDSA key/i.test(message))
    return {ok: false, reason: 'format'}
  return {ok: false, reason: 'node', detail: message}
}

// One import at a time: a new one, a closed dialog or a page left ends the ones before it.
export function createImportAttempts() {
  let current = 0
  return {
    start() {
      current += 1
      const mine = current
      return {isCurrent: () => current === mine}
    },
    endAll() {
      current += 1
    },
  }
}

export function importKeyErrorText(result, t) {
  switch (result.reason) {
    case 'password':
      return t(
        'The password does not open this key. Check the password the key was exported with.'
      )
    case 'format':
      return t(
        'This is not an exported Idena key. Paste the whole key, as Export gave it.'
      )
    case 'not-ready':
      return t(
        'The node did not finish starting. Try again once it is synchronized.'
      )
    case 'node-failed':
      return t(
        'The built-in node failed to start. Use Try restart in Settings > Node, then import the key.'
      )
    default:
      if (!result.detail) return t('The node did not import the key.')
      return t('The node did not import the key: {{reason}}', {
        reason: result.detail,
        nsSeparator: '|',
        interpolation: {escapeValue: false},
      })
  }
}
