import {useQuery, useQueryClient} from 'react-query'
import React from 'react'
import {socialRpc, socialRpcSettled} from './node'
import {profilesEnabled, readProfiles, readTrust} from './profiles'

/** How long a read profile or Trust count is shown before it is read again. */
const PROFILE_STALE_MS = 10 * 60 * 1000

/** The addresses a feed shows: the authors of its posts, answers and likes, and the tippers. */
export function feedAddresses(feed) {
  const addresses = new Set()
  const walk = (node) => {
    addresses.add(node.call.author)
    for (const like of node.likeCalls || []) addresses.add(like.author)
    for (const tip of node.tips || []) if (tip.from) addresses.add(tip.from)
    for (const reply of node.replies || []) walk(reply)
  }
  feed.forEach(walk)
  return addresses
}

/**
 * The profiles (readProfiles) of `addresses`, by lowercase address; {} while they are read, or without a profiles
 * contract. Read again after PROFILE_STALE_MS, or when `refreshProfiles` is called after a change.
 */
export function useProfiles(addresses) {
  const list = React.useMemo(
    () =>
      [
        ...new Set([...addresses].filter(Boolean).map((a) => a.toLowerCase())),
      ].sort(),
    [addresses]
  )
  const {data} = useQuery(
    ['profiles', list.join(',')],
    () => readProfiles(socialRpcSettled, list),
    {
      enabled: profilesEnabled && list.length > 0,
      staleTime: PROFILE_STALE_MS,
      keepPreviousData: true,
      retry: 1,
    }
  )
  return data || {}
}

/** The profile of one address (readProfiles), with its loading state and error. */
export function useProfile(address) {
  const key = address ? address.toLowerCase() : null
  return useQuery(
    ['profile', key],
    async () => (await readProfiles(socialRpcSettled, [key]))[key],
    {enabled: profilesEnabled && Boolean(key), staleTime: PROFILE_STALE_MS}
  )
}

/** The Trust of `target` (an address or "r/<topic>"): its givers and the counts (readTrust). */
export function useTrust(target) {
  const key = target ? String(target).toLowerCase() : null
  return useQuery(
    ['trust', key],
    () => readTrust(socialRpc, socialRpcSettled, key),
    {enabled: profilesEnabled && Boolean(key), staleTime: PROFILE_STALE_MS}
  )
}

/** Reads the profiles and Trust again: after a change of one's own in a block. */
export function useRefreshProfiles() {
  const client = useQueryClient()
  return React.useCallback(() => {
    client.invalidateQueries('profiles')
    client.invalidateQueries('profile')
    client.invalidateQueries('trust')
  }, [client])
}
