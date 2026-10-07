// idena.social (https://idena.social), read from the node: posts are makePost calls of its contracts, whose JSON
// argument holds the text, and tips are sendTip calls. The rules follow idena.social-ui (getNewPosterAndPost in
// src/logic/asyncUtils.ts, PostComponent.tsx) and the phone app (Social.kt); each contract version's calls are
// read in its own format (versions.js).

import {LIKE, MAX_INLINE_MEDIA} from './contract'

const textDecoder = new TextDecoder()

function hexToText(hex) {
  const clean = String(hex || '').replace(/^0x/, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return textDecoder.decode(bytes)
}

function parseObject(hex) {
  try {
    const value = JSON.parse(hexToText(hex))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

const text = (value) => (typeof value === 'string' ? value : '')

/**
 * The post a v1 or v5 reply answers: the web app first wrote the id as hex, the 16 bytes of a little-endian u128
 * ("0x2e00…" for 46), later as a decimal. Its media fields were never used then.
 */
function olderReplyTo(value) {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return value
  const hex = value.slice(2)
  let id = 0
  // Ids stay far below 2^53: the upper bytes are zero.
  for (let i = Math.min(hex.length, 12) - 2; i >= 0; i -= 2)
    id = id * 256 + parseInt(hex.substr(i, 2).padEnd(2, '0'), 16)
  return String(id)
}

/**
 * The post of a makePost call (bcn_contractCalls): its first argument is the JSON idena.social sends (message,
 * replyToPostId, channelId, media, mediaType). Null when it is not such JSON. `version` (versions.js) tells the
 * format; a post of an older version keeps its name.
 */
export function parsePost(
  {hash, height, timestamp, index, from, args},
  version = null
) {
  const arg = parseObject(args?.[0])
  if (!arg) return null
  const older = version?.format === 'v1'
  // v1 and v5 refuse a post without a message: such a call has no id.
  if (older && !text(arg.message)) return null
  const {media, mediaType} = arg
  const hasMedia =
    !older &&
    Array.isArray(media) &&
    media.length > 0 &&
    Array.isArray(mediaType) &&
    mediaType.length > 0
  const first = hasMedia ? text(media[0]) : ''
  const replyTo = text(arg.replyToPostId)
  return {
    ...(version?.prefix ? {version: version.name} : {}),
    hash,
    height,
    time: timestamp,
    index,
    author: String(from).toLowerCase(),
    message: text(arg.message),
    replyTo: older ? olderReplyTo(replyTo) : replyTo,
    channel: text(arg.channelId),
    hasMedia,
    media:
      first.startsWith('ipfs://') || first.length <= MAX_INLINE_MEDIA
        ? first
        : '',
    mediaType: hasMedia ? text(mediaType[0]) : '',
  }
}

/**
 * The tip of a sendTip call; the call sends `amount` iDNA. Since v11 its argument is {"postId", "tipAmount"}, the
 * tip in whole iDNA. Before, the tip was all that was sent (`sent`): v9 and v10 take {"postId"}, v1 and v5 the post
 * id as plain text.
 */
export function parseTip(
  {hash, height, timestamp, index, from, amount, args},
  version = null
) {
  let postId
  let tipAmount = ''
  if (version?.format === 'v1') {
    postId = hexToText(args?.[0]).trim()
    if (!/^[0-9]+$/.test(postId)) return null
  } else {
    const arg = parseObject(args?.[0])
    if (!arg) return null
    postId = text(arg.postId)
    tipAmount = text(arg.tipAmount)
  }
  const sent = version?.format === 'v1' || version?.format === 'v9'
  return {
    ...(version?.prefix ? {version: version.name} : {}),
    hash,
    height,
    time: timestamp,
    index,
    from: String(from).toLowerCase(),
    postId,
    tipAmount,
    amount: String(amount ?? ''),
    ...(sent ? {sent: true} : {}),
  }
}

/** The posts and tips among contract calls (bcn_contractCalls) of a contract `version`. */
export function callsToActivity(calls, version = null) {
  const posts = []
  const tips = []
  for (const call of calls) {
    if (call.method === 'makePost') {
      const post = parsePost(call, version)
      if (post) posts.push(post)
    } else if (call.method === 'sendTip') {
      const tip = parseTip(call, version)
      if (tip) tips.push(tip)
    }
  }
  return {posts, tips}
}

export const isLike = ({message, replyTo}) => message === LIKE && replyTo !== ''

const CID = /^[A-Za-z0-9]{10,128}$/

/** The IPFS content id of an "ipfs://<cid>" reference, or null when it is not one of plain letters and digits. */
export function ipfsCid(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('ipfs://')) return null
  const cid = ref.slice('ipfs://'.length)
  return CID.test(cid) ? cid : null
}

const WHOLE_IDNA = /^[0-9]{1,15}$/

/** Whether the whole number `a` is at least `b` (both plain digit strings, any length). */
function atLeast(a, b) {
  const x = a.replace(/^0+(?=.)/, '')
  const y = b.replace(/^0+(?=.)/, '')
  return x.length !== y.length ? x.length > y.length : x >= y
}

/**
 * The tip in iDNA when the contract accepts it (sendTip): a whole number of at least 1 and no more than was
 * sent; null otherwise (such a call fails). Before v11 (`sent`) the tip is what was sent, if anything.
 */
export function validTipAmount({tipAmount, amount, sent}) {
  if (sent) {
    const value = Number(amount)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (!WHOLE_IDNA.test(tipAmount) || Number(tipAmount) <= 0) return null
  const paid = /^([0-9]+)(?:\.[0-9]+)?$/.exec(String(amount))
  // The sent amount covers a whole tip exactly when its whole part does.
  return paid && atLeast(paid[1], tipAmount) ? Number(tipAmount) : null
}

/**
 * The continuation token of a contract_iterateMap page, or null after the last page, where the node returns "0x"
 * (an empty token, which would start over from the first page).
 */
export const nextPageToken = (token) =>
  typeof token === 'string' && token !== '' && token !== '0x' ? token : null

/**
 * The authors of the posts from the contract map "p:" (contract_iterateMap with hex keys and values): the key is
 * the post id as a little-endian u128, the value the author's address as text.
 */
export function postAuthors(items) {
  const authors = {}
  for (const {key, value} of items || []) {
    const bytes = String(key).replace(/^0x/, '').slice(0, 16)
    let id = 0
    // Ids stay far below 2^53: the upper bytes are zero.
    for (let i = bytes.length - 2; i >= 0; i -= 2)
      id = id * 256 + parseInt(bytes.substr(i, 2), 16)
    authors[id] = hexToText(value).toLowerCase()
  }
  return authors
}
