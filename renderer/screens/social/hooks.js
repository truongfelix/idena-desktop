import {useQuery} from 'react-query'
import {socialRpc} from './node'

/** The identity of an address (dna_identity): state, age and stake. */
export function useSocialIdentity(address) {
  return useQuery(
    ['social-identity', address],
    () => socialRpc('dna_identity', [address]),
    {enabled: Boolean(address), staleTime: 10 * 60 * 1000}
  )
}

/**
 * What an "ipfs://" reference holds, fetched through the app's own node (ipfs_get asks the node's IPFS peers),
 * as bytes; null when no node has it.
 */
export function useIpfsContent(cid) {
  return useQuery(
    ['social-ipfs', cid],
    async () => {
      let hex
      try {
        hex = await socialRpc('ipfs_get', [cid], 130 * 1000)
      } catch (fetchError) {
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
    {enabled: Boolean(cid), staleTime: Infinity, retry: false}
  )
}
