import {IdentityStatus} from '../../shared/types'
import {HASH_IN_MEMPOOL} from '../../shared/utils/utils'

export const canKill = (knownIdentity, persistedIdentity) =>
  persistedIdentity?.state === IdentityStatus.Invite ||
  (Boolean(knownIdentity) &&
    persistedIdentity?.state === IdentityStatus.Candidate)

/**
 * Whether a contact's invitation was terminated: its termination tx left the mempool and the node deleted the
 * invitee's identity (it answers `Undefined`). A termination that never made it into a block leaves the identity.
 */
export const isTerminatedInvite = ({terminateHash, terminating, state}) =>
  Boolean(terminateHash) && !terminating && state === IdentityStatus.Undefined

/**
 * The saved contacts as stored, shown before the node answers. Whether an invite can be terminated is the node's
 * to say, so no saved value of it is used.
 */
export const savedContacts = (savedInvites) =>
  savedInvites.map((invite) => ({...invite, dbkey: invite.id, canKill: false}))

/**
 * The saved contacts with what the node knows about them: the invite and termination txs, the invitee's identity
 * (`invitees`: the identity's invitees from the node). A node call that fails leaves out only its own part,
 * never a contact. `saveInvite(id, invite)` stores an invite whose invitee the node now knows.
 */
export async function loadInvites(
  savedInvites,
  invitees,
  {callRpc, fetchIdentity, saveInvite}
) {
  const orNull = (promise) => promise.catch(() => null)

  const txs = (
    await Promise.all(
      savedInvites
        .filter(({activated, deletedAt}) => !activated && !deletedAt)
        .map(({hash}) => orNull(callRpc('bcn_transaction', hash)))
    )
  ).filter(Boolean)

  const persistedInvitedIdentities = (
    await Promise.all(
      savedInvites
        .filter(({deletedAt}) => !deletedAt)
        .map(({receiver}) => orNull(fetchIdentity(receiver)))
    )
  ).filter(Boolean)

  const knownInvitedIdentities = (
    await Promise.all(
      (invitees ?? []).map(({Address}) => orNull(fetchIdentity(Address)))
    )
  ).filter(Boolean)

  const terminateTxs = await Promise.all(
    savedInvites
      .filter(({terminateHash, deletedAt}) => terminateHash && !deletedAt)
      .map(({terminateHash}) =>
        orNull(callRpc('bcn_transaction', terminateHash)).then((tx) => ({
          hash: terminateHash,
          ...tx,
        }))
      )
  )

  return savedInvites.map((invite) => {
    // find out mining invite status
    const tx = txs.find(({hash}) => hash === invite.hash)

    // find invitee to kill
    const invitee = invitees?.find(({TxHash}) => TxHash === invite.hash)

    // find all identities/invites
    const invitedIdentity =
      knownInvitedIdentities.find(
        (identity) => identity.address === invitee?.Address
      ) ||
      persistedInvitedIdentities.find(
        (identity) => identity.address === invite.receiver
      )

    // becomes activated once invitee is found
    const isNewInviteActivated = !!invitee

    // callRpc answers the tx itself; a tx still in the mempool has no block yet
    const isMining = tx?.blockHash === HASH_IN_MEMPOOL

    const terminateTx = terminateTxs.find(
      ({hash}) => hash === invite.terminateHash
    )

    const isTerminating = terminateTx?.blockHash === HASH_IN_MEMPOOL

    const nextInvite = {
      ...invite,
      activated: invite.activated || isNewInviteActivated,
      canKill: canKill(invitee, invitedIdentity),
      receiver: isNewInviteActivated ? invitee.Address : invite.receiver,
    }

    if (isNewInviteActivated) {
      // save changes once invitee is found
      saveInvite(invite.id, nextInvite)
    }

    return {
      ...nextInvite,
      dbkey: invite.id,
      mining: isMining,
      terminating: isTerminating,
      identity: invitedIdentity,
    }
  })
}

// The contacts marked `flag` whose tx (field `txField`) left the mempool, with the invitee's identity as the node
// now knows it, no longer marked. A contact whose tx is still in the mempool, or whose node call fails, stays as
// it is until the next check. Answers null when nothing changed.
async function checkSettled(invites, flag, txField, callRpc) {
  const settled = (
    await Promise.all(
      invites
        .filter((invite) => invite[flag])
        .map(async (invite) => {
          try {
            const tx = await callRpc('bcn_transaction', invite[txField])
            if (!tx || tx.blockHash === HASH_IN_MEMPOOL) return null
            const identity = await callRpc('dna_identity', invite.receiver)
            return identity ? {id: invite.id, identity} : null
          } catch {
            return null
          }
        })
    )
  ).filter(Boolean)

  if (settled.length === 0) return null

  return invites.map((invite) => {
    const {identity} = settled.find(({id}) => id === invite.id) ?? {}
    return identity
      ? {
          ...invite,
          [flag]: false,
          identity,
          state: identity.state,
          canKill: canKill(invite, identity),
        }
      : invite
  })
}

/**
 * The contacts whose invite tx left the mempool, no longer mining, with the invitee's identity (`Invite`: the
 * invitation can be terminated). See checkSettled.
 */
export const checkMining = (invites, {callRpc}) =>
  checkSettled(invites, 'mining', 'hash', callRpc)

/**
 * The contacts whose termination tx left the mempool, no longer terminating, with the invitee's identity
 * (`Undefined` once the tx is in a block: the node deletes a terminated identity). See checkSettled.
 */
export const checkTerminations = (invites, {callRpc}) =>
  checkSettled(invites, 'terminating', 'terminateHash', callRpc)

/**
 * What the contact list shows: the contacts that are not deleted and whose name or address holds `filter`
 * (any case), with `status` `list`, or why there are none: `empty` (no contacts) or `notFound` (none matches).
 */
export function contactListView(invites, filter) {
  const kept = invites.filter(({deletedAt}) => !deletedAt)
  const term = filter?.toLowerCase()
  const contacts = term
    ? kept.filter(({firstName, lastName, receiver}) =>
        [firstName, lastName, receiver].some((x) =>
          x?.toLowerCase().includes(term)
        )
      )
    : kept
  if (contacts.length > 0) return {contacts, status: 'list'}
  return {contacts, status: term ? 'notFound' : 'empty'}
}
