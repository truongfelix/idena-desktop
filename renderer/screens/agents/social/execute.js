/* global BigInt */
import {keccak256Hex} from '../../social/keccak'
import {
  LIKE,
  PostTarget,
  SocialCall,
  makePostArgument,
} from '../../social/contract'
import {
  MESSAGE_AMOUNT,
  findPublicKey,
  plainMessage,
  sendMessageArgument,
} from '../../social/messages'
import {nodeMessages, socialRpc} from '../../social/node'
import {
  estimateCall,
  fromWei,
  prepareCall,
  prepareDraft,
  sendPrepared,
  toWei,
  waitForBlock,
} from '../../social/posting'
import {callHeightsOf} from '../../social/scan'

// The Social actions of an agent (B-239, B-240), with the Social screen's own code (posting.js, messages.js): the
// node's key signs each one, as for the person's own click. Each action is first prepared (its call and the most it
// may cost), then sent; the To approve item keeps what it acts on (`target`) and its text (`body`), so an approved
// one is prepared again from them.

const MINED_WITHIN_MS = 10 * 60 * 1000

/** The most a prepared call may cost, in iDNA: its max fee, its files' fees twice, and the amount it sends. */
export function mostCost(pending) {
  const files = pending.files.reduce(
    (sum, file) => sum + file.fee * BigInt(2),
    BigInt(0)
  )
  const most = pending.fee.maxFee + files + toWei(pending.socialCall.amount)
  return Number(fromWei(most, 6, true))
}

/**
 * The public key of each of `others` (lowercase), from what the Social scan knows (`social`: its cache and the
 * shared message codes) or the node; throws for one that has none (it never signed anything).
 */
export async function publicKeysOf(others, social, node = nodeMessages()) {
  const keys = []
  for (const address of others) {
    // eslint-disable-next-line no-await-in-loop
    const key = await findPublicKey(address, {
      identityKey: node.identityKey,
      scannedKeys: social.cache?.keys || {},
      callHeights: social.cache ? callHeightsOf(social.cache, address) : [],
      keysAt: node.keysAt,
      sharedKeys: social.chatStore?.sharedKeys || {},
    })
    if (!key) throw new Error(`no message key for ${address}`)
    keys.push(key)
  }
  return keys
}

/**
 * One action prepared: `item` is {action, body, target, amount} as To approve keeps it. Returns the pending call
 * (posting.js) to send. Throws the reason it cannot be done (the contract's, the node's, a missing key).
 */
export async function prepareSocialAction(
  item,
  social,
  {call = socialRpc, node} = {}
) {
  const {action, body, target, amount} = item
  switch (action) {
    case 'post':
      return prepareDraft(call, {text: body, target: PostTarget.newPost()})
    case 'reply':
      if (!target?.postTarget) throw new Error('nothing to answer')
      return prepareDraft(call, {text: body, target: target.postTarget})
    case 'like':
      if (!target?.postTarget) throw new Error('nothing to like')
      return prepareCall(
        call,
        SocialCall.post(makePostArgument(LIKE, target.postTarget))
      )
    case 'tip':
      if (!(typeof target?.postId === 'number')) throw new Error('no post')
      if (!(Number.isInteger(amount) && amount >= 1))
        throw new Error('no amount')
      return prepareCall(call, SocialCall.tip(target.postId, amount))
    case 'message': {
      const others = Array.isArray(target?.others) ? target.others : []
      if (others.length !== 1) throw new Error('no one to write to')
      const from = String(await call('dna_getCoinbaseAddr')).toLowerCase()
      if (others[0] === from) throw new Error('its own account')
      const messages = node || nodeMessages(call)
      const keys = await publicKeysOf(others, social, messages)
      const plain = plainMessage(from, others, body)
      const parts = await messages.encrypt(keys, plain)
      if (!Array.isArray(parts) || parts.length !== others.length + 1)
        throw new Error('the node did not encrypt the message')
      const socialCall = {
        method: 'sendMessage',
        argument: sendMessageArgument(parts, keccak256Hex(plain)),
        amount: MESSAGE_AMOUNT,
      }
      const fee = await estimateCall(call, from, socialCall)
      return {from, socialCall, fee, files: []}
    }
    default:
      throw new Error(`no Social action ${action}`)
  }
}

/**
 * Sends a prepared action and waits for its block: a line for the Activity. Throws when it was refused (`sent`:
 * false, nothing spent) or not in a block in time (`sent`: true, it may still be).
 */
export async function sendSocialAction(
  pending,
  {call = socialRpc, pause, now = Date.now} = {}
) {
  const hash = await sendPrepared(call, pending)
  const sentError = (message) => Object.assign(new Error(message), {sent: true})
  const until = now() + MINED_WITHIN_MS
  const mined = await waitForBlock(call, hash, {
    pause:
      pause ||
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        })),
    isStopped: () => now() > until,
  })
  if (mined.result === 'dropped') throw new Error('the node dropped it')
  if (mined.result !== 'mined')
    throw Object.assign(sentError(`not in a block yet (${hash})`), {
      unconfirmed: true,
    })
  if (mined.error) throw sentError(mined.error)
  return `block ${mined.height}`
}

/** The executors of To approve for the Social actions (pending-api.js), over the Social state `getSocial()`. */
export function socialExecutors(getSocial, deps = {}) {
  const run = async (item) =>
    sendSocialAction(await prepareSocialAction(item, getSocial(), deps), deps)
  return {reply: run, like: run, tip: run, message: run}
}
