// idena.social (https://idena.social), read from the node: posts are makePost calls of its contract, whose JSON
// argument holds the text, and tips are sendTip calls. The rules follow idena.social-ui (getNewPosterAndPost in
// src/logic/asyncUtils.ts, PostComponent.tsx) and the phone app (Social.kt), for posts made since the current
// contract (v12).

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
 * The post of a makePost call (bcn_contractCalls): its first argument is the JSON idena.social sends (message,
 * replyToPostId, channelId, media, mediaType). Null when it is not such JSON.
 */
export function parsePost({hash, height, timestamp, index, from, args}) {
  const arg = parseObject(args?.[0])
  if (!arg) return null
  const {media, mediaType} = arg
  const hasMedia =
    Array.isArray(media) &&
    media.length > 0 &&
    Array.isArray(mediaType) &&
    mediaType.length > 0
  const first = hasMedia ? text(media[0]) : ''
  return {
    hash,
    height,
    time: timestamp,
    index,
    author: String(from).toLowerCase(),
    message: text(arg.message),
    replyTo: text(arg.replyToPostId),
    channel: text(arg.channelId),
    hasMedia,
    media:
      first.startsWith('ipfs://') || first.length <= MAX_INLINE_MEDIA
        ? first
        : '',
    mediaType: hasMedia ? text(mediaType[0]) : '',
  }
}

/** The tip of a sendTip call: its argument is {"postId", "tipAmount"}; the call sends `amount` iDNA. */
export function parseTip({hash, height, timestamp, index, from, amount, args}) {
  const arg = parseObject(args?.[0])
  if (!arg) return null
  return {
    hash,
    height,
    time: timestamp,
    index,
    from: String(from).toLowerCase(),
    postId: text(arg.postId),
    tipAmount: text(arg.tipAmount),
    amount: String(amount ?? ''),
  }
}

/** The posts and tips among contract calls (bcn_contractCalls). */
export function callsToActivity(calls) {
  const posts = []
  const tips = []
  for (const call of calls) {
    if (call.method === 'makePost') {
      const post = parsePost(call)
      if (post) posts.push(post)
    } else if (call.method === 'sendTip') {
      const tip = parseTip(call)
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
 * sent; null otherwise (such a call fails).
 */
export function validTipAmount({tipAmount, amount}) {
  if (!WHOLE_IDNA.test(tipAmount) || Number(tipAmount) <= 0) return null
  const sent = /^([0-9]+)(?:\.[0-9]+)?$/.exec(String(amount))
  // The sent amount covers a whole tip exactly when its whole part does.
  return sent && atLeast(sent[1], tipAmount) ? Number(tipAmount) : null
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
