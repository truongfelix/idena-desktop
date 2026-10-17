import {useQuery, useQueryClient} from 'react-query'
import React from 'react'
import {socialRpc, socialRpcSettled} from './node'
import {
  holderOf,
  parseRecipient,
  profilesEnabled,
  readProfiles,
  readTrust,
  readTrustsGiven,
  recipientAddress,
} from './profiles'
import {
  readChallenge,
  readMembers,
  readOffer,
  readOffersFrom,
  readOffersTo,
} from './vouching'
import {readIdentities} from './profile-lists'

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
    // The identities too: a profile's invitees and inviter come with them.
    client.invalidateQueries('social-identity')
  }, [client])
}

/** The identity state and age of each address (readIdentities), for a profile's lists of invitees and members. */
export function useIdentities(addresses) {
  return useQuery(
    ['profile', 'identities', addresses.join(',')],
    () => readIdentities(socialRpcSettled, addresses),
    {
      enabled: addresses.length > 0,
      staleTime: PROFILE_STALE_MS,
      keepPreviousData: true,
    }
  )
}

/** The vouches offered to `member` (readOffersTo). */
export function useOffersTo(member) {
  return useQuery(
    ['profile', 'offers-to', member],
    () => readOffersTo(socialRpc, member),
    {enabled: profilesEnabled && Boolean(member), staleTime: PROFILE_STALE_MS}
  )
}

/** The vouches `voucher` offered that wait for their answer (readOffersFrom). */
export function useOffersFrom(voucher) {
  return useQuery(
    ['profile', 'offers-from', voucher],
    () => readOffersFrom(socialRpc, voucher),
    {enabled: profilesEnabled && Boolean(voucher), staleTime: PROFILE_STALE_MS}
  )
}

/** The Trusts `giver` gives, to people and topics (readTrustsGiven). */
export function useTrustsGiven(giver) {
  return useQuery(
    ['profile', 'trusts-given', giver],
    () => readTrustsGiven(socialRpc, giver),
    {enabled: profilesEnabled && Boolean(giver), staleTime: PROFILE_STALE_MS}
  )
}

/** The members `voucher` vouches for (readMembers). */
export function useMembers(voucher) {
  return useQuery(
    ['profile', 'members', voucher],
    () => readMembers(socialRpc, voucher),
    {enabled: profilesEnabled && Boolean(voucher), staleTime: PROFILE_STALE_MS}
  )
}

/** Whether `voucher` offered to vouch for `member` (readOffer: its epoch, or null). */
export function useOffer(member, voucher) {
  return useQuery(
    ['profile', 'offer', member, voucher],
    () => readOffer(socialRpcSettled, member, voucher),
    {
      enabled: profilesEnabled && Boolean(member) && Boolean(voucher),
      staleTime: PROFILE_STALE_MS,
    }
  )
}

/** The challenge of `challenger` on `name` (readChallenge). */
export function useChallenge(name, challenger) {
  return useQuery(
    ['profile', 'challenge', name, challenger],
    () => readChallenge(socialRpcSettled, name, challenger),
    {
      enabled: profilesEnabled && Boolean(name) && Boolean(challenger),
      staleTime: PROFILE_STALE_MS,
    }
  )
}

/**
 * The recipient a "To" field names (parseRecipient), with, for "@name", its holder and the holder's profile
 * ({holder: null} when nobody holds it); `address` is whom to send to (recipientAddress).
 */
export function useRecipient(text) {
  const recipient = parseRecipient(text)
  const name = recipient.kind === 'name' ? recipient.name : null
  const query = useQuery(
    ['profile', 'recipient', name],
    async () => {
      const holder = await holderOf(socialRpcSettled, name)
      if (!holder) return {holder: null, profile: null}
      const profiles = await readProfiles(socialRpcSettled, [holder])
      return {holder, profile: profiles[holder]}
    },
    {enabled: profilesEnabled && Boolean(name), staleTime: 60 * 1000}
  )
  return {
    recipient,
    resolved: query.data ?? null,
    isLoading: query.isLoading && Boolean(name),
    isError: query.isError,
    address: recipientAddress(recipient, query.data),
  }
}
