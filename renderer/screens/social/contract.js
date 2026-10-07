/**
 * A test network's copy of the contract, given when the app starts: IDENA_SOCIAL_CONTRACT=<address>@<first block>.
 * The app reads and writes mainnet's otherwise.
 */
const testContract = /^(0x[0-9a-fA-F]{40})@([0-9]{1,12})$/.exec(
  global.env?.IDENA_SOCIAL_CONTRACT || ''
)

/** Whether the app reads a test network's contract (which has no older versions). */
export const isTestContract = Boolean(testContract)

/** The idena.social contract (idena.social-ui v12) and the block where its posts start. */
export const SOCIAL_CONTRACT = testContract
  ? testContract[1]
  : '0x840e092e31e9656fF15E541505039ed77585338E'
export const SOCIAL_FIRST_BLOCK = testContract
  ? Number(testContract[2])
  : 10929805

/** A reply made of this text only is a like of the post it replies to. */
export const LIKE = '❤️'

/** Inline media larger than this (base64 characters, about 1 MB) is not kept in the scan. */
export const MAX_INLINE_MEDIA = 1400000

/** idena.social sends this amount (iDNA) with each post; the contract passes it on in its event. */
export const POST_AMOUNT = '0.00001'

/**
 * What a post, reply, comment or like answers: the fields of its makePost argument, and the level of what it
 * answers. A reply answers a post; a comment answers a reply, or a comment under it, in the reply's channel.
 */
export const PostTarget = {
  newPost: () => ({level: null, replyTo: null, channel: null}),
  onPost: (postId) => ({level: 'post', replyTo: postId, channel: null}),
  onReply: (replyId) => ({
    level: 'reply',
    replyTo: replyId,
    channel: `discuss:${replyId}`,
  }),
  onComment: (replyId, commentId) => ({
    level: 'comment',
    replyTo: commentId,
    channel: `discuss:${replyId}`,
  }),
}

/**
 * The argument of a makePost call, with idena.social's keys in its order: the message, what it answers (a post id
 * as text), the channel of a comment, and one media ("ipfs://<cid>") with its type. Absent keys are left out.
 */
export function makePostArgument(
  message,
  {replyTo = null, channel = null, media = null, mediaType = null} = {}
) {
  const arg = {message}
  if (replyTo !== null) arg.replyToPostId = String(replyTo)
  if (channel !== null) arg.channelId = channel
  if (media !== null && mediaType !== null) {
    arg.media = [media]
    arg.mediaType = [mediaType]
  }
  return JSON.stringify(arg)
}

/** The argument of a sendTip call: `amount` whole iDNA for the author of post `postId`. */
export const sendTipArgument = (postId, amount) =>
  JSON.stringify({postId: String(postId), tipAmount: String(amount)})

/** A call of the contract: its method, its one JSON argument, and the iDNA it sends. */
export const SocialCall = {
  post: (argument) => ({method: 'makePost', argument, amount: POST_AMOUNT}),
  tip: (postId, amount) => ({
    method: 'sendTip',
    argument: sendTipArgument(postId, amount),
    amount: String(amount),
  }),
}
