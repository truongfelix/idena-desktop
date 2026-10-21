// Imports a node key through dna_importKey, waiting for the node's full RPC.
// For its first seconds (minutes after a long sync or a DB compaction) the node serves only `bcn`, and
// every other method answers "The method … does not exist/is not available"; while the built-in node
// restarts, the call cannot reach it at all. Both are retried until the node answers or the time is up.

export const IMPORT_WAIT_MS = 5 * 60 * 1000
export const IMPORT_RETRY_MS = 2000

const NOT_SERVED_YET = /does not exist\/is not available/i

function isNodeStarting(error) {
  return NOT_SERVED_YET.test(error?.message ?? '')
}

/**
 * @returns {Promise<{ok: true} | {ok: false, reason: string, detail?: string}>}
 * reason: 'password', 'format', 'not-ready', 'cancelled' or 'node' (detail: the node's text)
 */
export async function importKeyWhenReady(
  importKey,
  key,
  password,
  {
    waitMs = IMPORT_WAIT_MS,
    retryMs = IMPORT_RETRY_MS,
    now = () => Date.now(),
    sleep = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    onWaiting = () => {},
    isCancelled = () => false,
  } = {}
) {
  const deadline = now() + waitMs
  for (;;) {
    if (isCancelled()) return {ok: false, reason: 'cancelled'}
    let error
    let unreachable = false
    try {
      ;({error} = await importKey(key, password))
    } catch {
      unreachable = true
    }
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
  const message = error?.message ?? ''
  if (/error while decrypting key/i.test(message))
    return {ok: false, reason: 'password'}
  if (/error while decoding key|is not valid ECDSA key/i.test(message))
    return {ok: false, reason: 'format'}
  return {ok: false, reason: 'node', detail: message}
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
    default:
      return t('The node did not import the key: {{reason}}', {
        reason: result.detail,
        nsSeparator: '|',
        interpolation: {escapeValue: false},
      })
  }
}
