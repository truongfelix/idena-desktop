import {getRpcParams} from '../../shared/api/api-client'
import {callsToActivity, nextPageToken, postAuthors} from './calls'
import {CURRENT_VERSION} from './versions'

/** The node drops a request after a minute (its HTTP write timeout): the app gives up a little later. */
const RPC_TIMEOUT = 70 * 1000

/**
 * The blocks one call of bcn_contractCalls reads: the node reads 8 bodies at once, each up to 30 s when it
 * fetches it from its peers, so one round stays within the node's minute.
 */
export const BLOCKS_PER_CALL = 8

/**
 * The blocks one bcn_blocksWithAddress call checks: the node reads each block's header, thousands a second
 * from flash storage but about a hundred from a cold hard disk. It starts small, doubles while calls are quick
 * and halves when they are slow or fail.
 */
export const FIRST_BATCH = 2000
export const MIN_BATCH = 250
export const MAX_BATCH = 10000
const QUICK_SECONDS = 10
const SLOW_SECONDS = 30

/** A node RPC call with a timeout; throws the node's error message. */
export async function socialRpc(method, params = [], timeout = RPC_TIMEOUT) {
  const {url, key} = getRpcParams()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
      body: JSON.stringify({method, params, id: 1, key}),
      signal: controller.signal,
    })
    const {result, error} = await response.json()
    if (error) throw new Error(error.message)
    return result
  } catch (error) {
    if (!controller.signal.aborted) throw error
    const timedOut = new Error(
      `${method}: no answer within ${timeout / 1000} s`
    )
    timedOut.timeout = true
    throw timedOut
  } finally {
    clearTimeout(timer)
  }
}

/** Whether an RPC error says that the node lacks the method (an older or official node). */
export const isMissingMethod = (error) =>
  /does not exist|not available/i.test(String(error?.message))

/**
 * idena.social through the app's node: bcn_blocksWithAddress picks the blocks with a call of a contract version
 * (versions.js; the current one by default) from their headers, bcn_contractCalls reads those calls (sender,
 * method, argument) from the bodies. `call` makes an RPC call; `now` gives the time in ms.
 */
export function nodeSocialSource(call = socialRpc, now = () => Date.now()) {
  let batch = FIRST_BATCH
  return {
    batchSize: () => batch,

    head: async () => (await call('bcn_lastBlock')).height,

    async calls(from, to, version = CURRENT_VERSION) {
      const started = now()
      let heights
      try {
        heights = await call('bcn_blocksWithAddress', [
          {address: version.address, from, to},
        ])
      } catch (error) {
        if (!isMissingMethod(error))
          batch = Math.max(Math.floor(batch / 2), MIN_BATCH)
        throw error
      }
      const seconds = (now() - started) / 1000
      if (seconds < QUICK_SECONDS) batch = Math.min(batch * 2, MAX_BATCH)
      else if (seconds > SLOW_SECONDS)
        batch = Math.max(Math.floor(batch / 2), MIN_BATCH)

      const found = []
      for (let i = 0; i < (heights || []).length; i += BLOCKS_PER_CALL) {
        // eslint-disable-next-line no-await-in-loop
        const calls = await call('bcn_contractCalls', [
          {
            contract: version.address,
            heights: heights.slice(i, i + BLOCKS_PER_CALL),
          },
        ])
        found.push(...(calls || []))
      }
      return callsToActivity(found, version)
    },

    async authors(version = CURRENT_VERSION) {
      const authors = {}
      const seen = new Set()
      let token = null
      do {
        // eslint-disable-next-line no-await-in-loop
        const page = await call('contract_iterateMap', [
          version.address,
          'p:',
          token,
          'hex',
          'hex',
          100,
        ])
        Object.assign(authors, postAuthors(page?.items))
        token = nextPageToken(page?.continuationToken)
        // A token seen before would start the same pages again.
        if (token !== null && seen.has(token))
          throw new Error('contract_iterateMap repeats its pages')
        if (token !== null) seen.add(token)
      } while (token !== null)
      return authors
    },
  }
}
