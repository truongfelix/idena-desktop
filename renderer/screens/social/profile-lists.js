import {isSocialAddress} from './people'

// The two lists every profile shows besides its posts, as the phone app's (B-79): its invitees, from the node's
// dna_identity (each kept there from its invitation until it is Verified or Human, or killed), and the members it
// vouches for, from the profiles contract (vouching.js, readMembers). Each row shows the account's identity state,
// read for all of them in one dna_identity batch.

/** An address as the lists keep it: lowercase; null when it is not one. */
const addressOf = (value) =>
  isSocialAddress(value) ? String(value).toLowerCase() : null

/**
 * The invitees of a dna_identity answer, in the node's order, each once: the node writes each as {TxHash, Address}
 * (state.TxAddr); invalid entries are left out.
 */
export function inviteeAddresses(identity) {
  const list = Array.isArray(identity?.invitees) ? identity.invitees : []
  return [
    ...new Set(
      list.map((entry) => addressOf(entry?.Address ?? entry?.address))
    ),
  ].filter(Boolean)
}

/** Who invited the identity of a dna_identity answer ({txHash, address, epochHeight}), while the link lasts; else null. */
export const inviterOf = (identity) => addressOf(identity?.inviter?.address)

/**
 * The identity state and age of each address (lowercase) from one batch of dna_identity calls (`settled`:
 * node.js socialRpcSettled): {[address]: {state, age}}. Throws when one of them failed: a list is shown whole or
 * not at all.
 */
export async function readIdentities(settled, addresses) {
  const answers = await settled(
    'dna_identity',
    addresses.map((address) => [address])
  )
  const failed = answers.find((answer) => answer.error)
  if (failed) throw failed.error
  return Object.fromEntries(
    addresses.map((address, i) => {
      const {state = '', age = 0} = answers[i].result || {}
      return [address, {state, age: Number(age) || 0}]
    })
  )
}
