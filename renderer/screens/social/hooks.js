import {useQuery} from 'react-query'
import {isMissingMethod, socialRpc} from './node'

/** The identity of an address (dna_identity): state, age and stake. */
export function useSocialIdentity(address) {
  return useQuery(
    ['social-identity', address],
    () => socialRpc('dna_identity', [address]),
    {enabled: Boolean(address), staleTime: 10 * 60 * 1000}
  )
}

/**
 * How many ipfs_get calls the window sends to the node at once (B-288). The window has 6 connections to the node,
 * and a read of content no peer has holds one for the node's 30 s: a feed page asks for up to 30 pictures, and the
 * other calls would wait behind them. Four leave two for the rest (the scan, the profile read); a picture found
 * still waits for at most four missing ones at a time. The others wait in the app, their timer not started yet.
 */
export const MAX_IPFS_READS = 4
/** Content no node had is asked again after this pause (B-288): it may turn up later. */
export const MISSING_RETRY_MS = 10 * 60 * 1000
/** A node that is starting refuses ipfs_get for some seconds: the read is tried again this often, this many times. */
export const STARTING_RETRY_MS = 5 * 1000
export const STARTING_RETRIES = 6
/** How long the app waits for one ipfs_get once it is sent: the node gives up first. */
const IPFS_TIMEOUT = 130 * 1000

/** A runner of `task()`s, at most `limit` at a time, the others in the order they came. */
export function limitedRunner(limit) {
  let running = 0
  const waiting = []
  const next = () => {
    if (running >= limit || !waiting.length) return
    running += 1
    const {task, resolve, reject} = waiting.shift()
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        running -= 1
        next()
      })
  }
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push({task, resolve, reject})
      next()
    })
}

const ipfsReads = limitedRunner(MAX_IPFS_READS)

/** One ipfs_get through the node, in the window's queue of IPFS reads. */
const readIpfs = (cid) =>
  ipfsReads(() => socialRpc('ipfs_get', [cid], IPFS_TIMEOUT))

/** The query of an "ipfs://" reference's content; `read(cid)` answers the node's hex (readIpfs). */
export function ipfsContentQuery(cid, read = readIpfs) {
  return {
    queryKey: ['social-ipfs', cid],
    queryFn: async () => {
      let hex
      try {
        hex = await read(cid)
      } catch (fetchError) {
        // A node that is starting refuses ipfs_get as any method but bcn_: tried again (retry), not "missing".
        if (isMissingMethod(fetchError)) throw fetchError
        // The node names IPFS when no peer has the content ("timeout while reading data from ipfs").
        if (/ipfs/i.test(String(fetchError?.message))) return null
        throw fetchError
      }
      if (!hex || hex === '0x') return null
      const clean = hex.replace(/^0x/, '')
      const bytes = new Uint8Array(clean.length / 2)
      for (let i = 0; i < bytes.length; i += 1)
        bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
      return bytes
    },
    enabled: Boolean(cid),
    staleTime: Infinity,
    // The view keeps "Loading…" while a starting node's refusal is tried again; any other error is shown at once.
    retry: (failures, error) =>
      isMissingMethod(error) && failures < STARTING_RETRIES,
    retryDelay: STARTING_RETRY_MS,
    // Found, it never changes (a CID names its content); missing, asked again while it is on screen.
    refetchInterval: (data) => (data === null ? MISSING_RETRY_MS : false),
  }
}

/**
 * What an "ipfs://" reference holds, fetched through the app's own node (ipfs_get asks the node's IPFS peers),
 * as bytes; null when no node has it.
 */
export function useIpfsContent(cid) {
  return useQuery(ipfsContentQuery(cid))
}
