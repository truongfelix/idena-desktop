/* global BigInt */
// Writing to idena.social with the node's key, as the phone app does (SocialPosting in SocialNode.kt): a dry run of
// the call gives the fee shown before sending, then the node signs and sends it. Files (a long text, an image) go
// to IPFS first, kept by the network through a storeToIpfs transaction. `call` makes a node RPC call.

import {SOCIAL_CONTRACT, SocialCall, makePostArgument} from './contract'

/** The type of a storeToIpfs transaction (types.StoreToIpfsTx). */
export const STORE_TO_IPFS_TX = 0x15

/** The largest file stored at once: the node takes requests up to 2 MB, and the file goes as hex. */
export const MAX_IPFS_FILE = 900000

/** The type of the images the app posts. */
export const IMAGE_TYPE = 'image/webp'

/** Adding a file to IPFS can take a while on a slow disk. */
const IPFS_ADD_TIMEOUT = 180 * 1000

/** How often a sent transaction is looked up until it is in a block. */
export const BLOCK_POLL_MS = 10 * 1000

/** Lookups in a row that find nothing before a sent transaction counts as dropped by the node. */
const UNKNOWN_LOOKUPS = 3

const WEI = BigInt('1000000000000000000')
const TEN = BigInt(10)
const TWO = BigInt(2)

/** An iDNA amount as text ("4705.4") in 10^-18 iDNA. */
export function toWei(text) {
  const m = /^([0-9]*)(?:\.([0-9]*))?$/.exec(String(text ?? '0').trim())
  if (!m) throw new Error(`not an amount: ${text}`)
  const fraction = (m[2] || '').slice(0, 18).padEnd(18, '0')
  return BigInt(m[1] || '0') * WEI + BigInt(fraction)
}

/** 10^-18 iDNA as text with `decimals` places, rounded down, or up with `roundUp`. */
export function fromWei(wei, decimals, roundUp = false) {
  const unit = TEN ** BigInt(18 - decimals)
  let units = wei / unit
  if (roundUp && units * unit < wei) units += BigInt(1)
  if (decimals === 0) return units.toString()
  const scale = TEN ** BigInt(decimals)
  const fraction = (units % scale).toString().padStart(decimals, '0')
  return `${units / scale}.${fraction}`
}

/** 10^-18 iDNA rounded up to 6 places, the precision of a max fee. */
const ceilTo6 = (wei) => toWei(fromWei(wei, 6, true))

export const toHex = (bytes) =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`

const utf8 = (text) => new TextEncoder().encode(text)

/** The bytes of a CID as ipfs_add gives it: version 1, base32 ("b" then RFC 4648 lowercase). */
export function cidBytes(cid) {
  if (typeof cid !== 'string' || cid.length < 2 || cid[0] !== 'b')
    throw new Error(`not a version 1 CID: ${cid}`)
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const out = []
  let buffer = 0
  let bits = 0
  for (const c of cid.slice(1)) {
    const value = alphabet.indexOf(c)
    if (value < 0) throw new Error(`not base32: ${cid}`)
    // eslint-disable-next-line no-bitwise
    buffer = ((buffer << 5) | value) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      // eslint-disable-next-line no-bitwise
      out.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

function varint(value) {
  const out = []
  let v = value
  while (v >= 0x80) {
    out.push((v % 0x80) + 0x80)
    v = Math.floor(v / 0x80)
  }
  out.push(v)
  return out
}

/** The payload of a storeToIpfs transaction (ProtoStoreToIpfsAttachment: cid = 1, size = 2). */
export function storeToIpfsPayload(cid, size) {
  const bytes = cidBytes(cid)
  return Uint8Array.from([
    0x0a,
    ...varint(bytes.length),
    ...bytes,
    0x10,
    ...varint(size),
  ])
}

/**
 * About what storing `size` bytes on IPFS costs, before the node estimates it: idena-go counts a fifth of the file
 * as transaction bytes (fee.getTxSizeForFee), 10 gas each, plus 150 bytes. `feePerGas` in 10^-18 iDNA.
 */
export const storeFeeHint = (feePerGas, size) =>
  BigInt(feePerGas) * BigInt((150 + Math.floor(size / 5)) * 10)

/** The params of a contract call; with a max fee to send it, without one to estimate it. */
export function callParams(from, {method, argument, amount}, maxFee = null) {
  const params = {
    from,
    contract: SOCIAL_CONTRACT,
    method,
    amount,
    args: [{index: 0, format: 'string', value: argument}],
  }
  if (maxFee !== null) params.maxFee = maxFee
  return [params]
}

/**
 * The fee of a call from a dry run by the node: about `fee`, at most `maxFee`, twice the estimate as the node's own
 * margin for plain transactions (the gas price may change before the call is in a block; only the fee used is
 * taken). Both in 10^-18 iDNA. Throws with the contract's reason, or the node's (e.g. insufficient funds).
 */
export async function estimateCall(call, from, socialCall) {
  const receipt = await call(
    'contract_estimateCall',
    callParams(from, socialCall)
  )
  if (!receipt?.success)
    throw new Error(receipt?.error || 'the contract refused the post')
  const fee = toWei(receipt.txFee) + toWei(receipt.gasCost)
  return {fee, maxFee: ceilTo6(fee * TWO)}
}

/**
 * A file to store on IPFS before the post: its CID as the node computes it, and the fee of its storeToIpfs
 * transaction. A file this app already stored (`stored`, by CID) costs nothing again.
 */
export async function prepareFile(call, from, what, bytes, stored = new Set()) {
  if (bytes.length > MAX_IPFS_FILE)
    throw new Error(
      `the ${what} is too large (${Math.floor(
        bytes.length / 1000
      )} KB, at most 900 KB)`
    )
  const cid = await call('ipfs_cid', [toHex(bytes)])
  if (stored.has(cid)) return {what, bytes, cid, fee: BigInt(0), stored: true}
  const estimate = await call('bcn_estimateTx', [
    {
      type: STORE_TO_IPFS_TX,
      from,
      payload: toHex(storeToIpfsPayload(cid, bytes.length)),
    },
  ])
  return {what, bytes, cid, fee: toWei(estimate?.txFee), stored: false}
}

/** A like or a tip, ready to confirm: the fee, from the node's dry run. */
export async function prepareCall(call, socialCall) {
  const from = await call('dna_getCoinbaseAddr')
  const fee = await estimateCall(call, from, socialCall)
  return {from, socialCall, fee, files: []}
}

/**
 * A post, reply or comment from the editor, ready to confirm: its files (the text when it goes on IPFS, then the
 * image), the call and the fees. Throws when the balance cannot pay the most it may cost.
 */
export async function prepareDraft(
  call,
  {text, textOnIpfs = false, image = null, target},
  stored = new Set()
) {
  const from = await call('dna_getCoinbaseAddr')
  const files = []
  let message = text.trim()
  if (textOnIpfs && message) {
    const file = await prepareFile(call, from, 'text', utf8(message), stored)
    files.push(file)
    message = `ipfs://${file.cid}`
  }
  let media = null
  if (image) {
    const file = await prepareFile(call, from, 'image', image, stored)
    files.push(file)
    media = `ipfs://${file.cid}`
  }
  const socialCall = SocialCall.post(
    makePostArgument(message, {
      replyTo: target.replyTo,
      channel: target.channel,
      media,
      mediaType: media ? IMAGE_TYPE : null,
    })
  )
  const fee = await estimateCall(call, from, socialCall)
  const {balance} = (await call('dna_getBalance', [from])) || {}
  const most =
    fee.maxFee +
    files.reduce((sum, file) => sum + file.fee * TWO, BigInt(0)) +
    toWei(socialCall.amount)
  if (toWei(balance) < most)
    throw new Error(
      `up to ${fromWei(most, 2, true)} iDNA needed, the balance is ${fromWei(
        toWei(balance),
        2
      )}`
    )
  return {from, socialCall, fee, files}
}

/** About what a prepared call costs in all: its fee and its files'. */
export const totalFee = (pending) =>
  pending.files.reduce((sum, file) => sum + file.fee, pending.fee.fee)

/**
 * Sends a prepared call: each file not stored yet goes to IPFS (`onFile(what)` before each, `onStored(cid)` once
 * the network is asked to keep it), then the call itself. Returns the call's transaction hash.
 */
export async function sendPrepared(call, pending, {onFile, onStored} = {}) {
  for (const file of pending.files) {
    // eslint-disable-next-line no-continue
    if (file.stored) continue
    onFile?.(file.what)
    // eslint-disable-next-line no-await-in-loop
    const cid = await call(
      'ipfs_add',
      [toHex(file.bytes), true],
      IPFS_ADD_TIMEOUT
    )
    if (cid !== file.cid)
      throw new Error(
        `the node stored the ${file.what} under another CID (${cid})`
      )
    // eslint-disable-next-line no-await-in-loop
    await call('dna_storeToIpfs', [{cid}])
    onStored?.(cid)
  }
  return call(
    'contract_call',
    callParams(pending.from, pending.socialCall, fromWei(pending.fee.maxFee, 6))
  )
}

/**
 * Waits until the node has the transaction `hash` in a block. Returns 'mined' with the block's `height` and the
 * contract's verdict (`error` when it refused the call: the fee is paid, nothing is posted), 'dropped' when the node
 * no longer knows it, or 'stopped'. A failed lookup (the node restarting) is tried again.
 */
export async function waitForBlock(call, hash, {pause, isStopped}) {
  let unknown = 0
  while (!isStopped()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const tx = await call('bcn_transaction', [hash])
      if (!tx) {
        unknown += 1
        if (unknown >= UNKNOWN_LOOKUPS) return {result: 'dropped'}
      } else {
        unknown = 0
        if (/[1-9a-f]/i.test(String(tx.blockHash || '').replace(/^0x/, ''))) {
          // eslint-disable-next-line no-await-in-loop
          const block = await call('bcn_block', [tx.blockHash])
          if (!block) throw new Error(`block ${tx.blockHash} is missing`)
          // eslint-disable-next-line no-await-in-loop
          const receipt = await call('bcn_txReceipt', [hash]).catch(() => null)
          return {
            result: 'mined',
            height: block.height,
            error:
              receipt && receipt.success === false
                ? receipt.error || 'the contract refused it'
                : null,
          }
        }
      }
    } catch {
      unknown = 0
    }
    // eslint-disable-next-line no-await-in-loop
    await pause(BLOCK_POLL_MS)
  }
  return {result: 'stopped'}
}
