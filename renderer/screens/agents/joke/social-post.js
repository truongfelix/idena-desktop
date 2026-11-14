import {socialRpc} from '../../social/node'
import {PostTarget} from '../../social/contract'
import {
  fromWei,
  prepareDraft,
  sendPrepared,
  toWei,
  waitForBlock,
} from '../../social/posting'

// A post on Idena Social for an agent (its "post" action), with the Social editor's own code (posting.js): the
// node's key signs it, as for the person's own post. `call` is the node RPC (socialRpc).

/** How long a sent post is waited for: a few blocks. */
const MINED_WITHIN_MS = 10 * 60 * 1000

/** The most the post may cost, in iDNA (its max fee and the amount the contract call sends), rounded up. */
export async function postCost(body, call = socialRpc) {
  const pending = await prepareDraft(call, {
    text: body,
    target: PostTarget.newPost(),
  })
  const most = pending.fee.maxFee + toWei(pending.socialCall.amount)
  return Number(fromWei(most, 6, true))
}

/**
 * Posts `body` and waits for its block. Resolves to a line for the Activity; throws when the node or the contract
 * refused it, or it was not in a block in time.
 */
export async function postOnSocial(
  body,
  {call = socialRpc, pause, now = Date.now} = {}
) {
  const pending = await prepareDraft(call, {
    text: body,
    target: PostTarget.newPost(),
  })
  const hash = await sendPrepared(call, pending)
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
  if (mined.result === 'dropped') throw new Error('the node dropped the post')
  if (mined.result !== 'mined')
    throw new Error(`the post is not in a block yet (${hash})`)
  if (mined.error) throw new Error(mined.error)
  return `block ${mined.height}`
}
