/* global BigInt */
import {
  LIKE,
  PostTarget,
  SOCIAL_CONTRACT,
  SocialCall,
  makePostArgument,
  sendTipArgument,
} from './contract'
import {parsePost, parseTip, ipfsCid, validTipAmount} from './calls'
import {
  STORE_TO_IPFS_TX,
  cidBytes,
  estimateCall,
  fromWei,
  prepareCall,
  prepareDraft,
  sendPrepared,
  storeFeeHint,
  storeToIpfsPayload,
  toHex,
  toWei,
  totalFee,
  waitForBlock,
} from './posting'

// The vectors come from the phone app's SocialTest.kt: both apps write idena.social the same way.

const hex = (text) => `0x${Buffer.from(text, 'utf8').toString('hex')}`
const me = '0xAAAA000000000000000000000000000000000001'

/** A node answering each method from `answers` (a value or a function of the params); records the calls. */
function scriptedNode(answers) {
  const calls = []
  const call = async (method, params = []) => {
    calls.push({method, params})
    if (!(method in answers)) throw new Error(`unexpected ${method}`)
    const answer = answers[method]
    return typeof answer === 'function' ? answer(params) : answer
  }
  return {call, calls, methods: () => calls.map(({method}) => method)}
}

describe('the arguments', () => {
  it('writes posts as idena.social writes them', () => {
    expect(makePostArgument('see https://idena.io')).toBe(
      '{"message":"see https://idena.io"}'
    )
    expect(makePostArgument(LIKE, {replyTo: 12})).toBe(
      '{"message":"❤️","replyToPostId":"12"}'
    )
    // A like of comment 15 under reply 12.
    const target = PostTarget.onComment(12, 15)
    expect(makePostArgument(LIKE, target)).toBe(
      '{"message":"❤️","replyToPostId":"15","channelId":"discuss:12"}'
    )
    expect(
      makePostArgument('look', {
        media: 'ipfs://bafkreiabc',
        mediaType: 'image/webp',
      })
    ).toBe(
      '{"message":"look","media":["ipfs://bafkreiabc"],"mediaType":["image/webp"]}'
    )
    expect(
      makePostArgument('', {
        ...PostTarget.onReply(7),
        media: 'ipfs://bafkreiabc',
        mediaType: 'image/webp',
      })
    ).toBe(
      '{"message":"","replyToPostId":"7","channelId":"discuss:7","media":["ipfs://bafkreiabc"],"mediaType":["image/webp"]}'
    )
    expect(PostTarget.newPost()).toEqual({
      level: null,
      replyTo: null,
      channel: null,
    })
  })

  it('reads back what it writes', () => {
    const post = parsePost({
      hash: '0x01',
      height: 1,
      timestamp: 1,
      index: 0,
      from: me,
      args: [hex(makePostArgument('line 1\nline "2"', {replyTo: 7}))],
    })
    expect(post.message).toBe('line 1\nline "2"')
    expect(post.replyTo).toBe('7')
    const withMedia = parsePost({
      hash: '0x01',
      height: 1,
      timestamp: 1,
      index: 0,
      from: me,
      args: [
        hex(
          makePostArgument('ipfs://bafkreitext', {
            media: 'ipfs://bafkreiimg',
            mediaType: 'image/webp',
          })
        ),
      ],
    })
    expect(withMedia.hasMedia).toBe(true)
    expect(withMedia.media).toBe('ipfs://bafkreiimg')
    expect(ipfsCid(withMedia.message)).toBe('bafkreitext')
  })

  it('writes tips as idena.social writes them', () => {
    expect(sendTipArgument(102, 5)).toBe('{"postId":"102","tipAmount":"5"}')
    const call = SocialCall.tip(102, 5)
    expect(call).toEqual({
      method: 'sendTip',
      argument: '{"postId":"102","tipAmount":"5"}',
      amount: '5',
    })
    const tip = parseTip({
      hash: '0x01',
      height: 1,
      timestamp: 1,
      index: 0,
      from: '0xAB',
      amount: call.amount,
      args: [hex(call.argument)],
    })
    expect(tip.postId).toBe('102')
    expect(validTipAmount(tip)).toBe(5)
    expect(SocialCall.post('{}').amount).toBe('0.00001')
  })
})

describe('amounts', () => {
  it('converts iDNA exactly', () => {
    expect(toWei('4705.4')).toBe(BigInt('4705400000000000000000'))
    expect(toWei('0.00001')).toBe(BigInt('10000000000000'))
    expect(toWei(undefined)).toBe(BigInt(0))
    expect(() => toWei('1e5')).toThrow()
    expect(fromWei(toWei('163.734'), 2, true)).toBe('163.74')
    expect(fromWei(toWei('163.739'), 2)).toBe('163.73')
    expect(fromWei(toWei('2'), 2, true)).toBe('2.00')
    expect(fromWei(toWei('0.000000000000000001'), 6, true)).toBe('0.000001')
  })

  it('estimates the cost of storing a file', () => {
    // 10^14 per gas (0.0001 iDNA): 10 gas per byte for 150 bytes plus a fifth of 50,000.
    expect(fromWei(storeFeeHint(BigInt('100000000000000'), 50000), 2)).toBe(
      '10.15'
    )
  })
})

describe('the storeToIpfs payload', () => {
  it('holds the CID and the size', () => {
    const cid = 'bafkreifcg3m5p24psikerh4eqi3yeyyfbkvyrzukitfi2s3o2p4wwrlzpe'
    // Expected bytes from Python's base64.b32decode: CID v1, raw, sha2-256, 32 bytes.
    expect(toHex(cidBytes(cid))).toBe(
      '0x01551220a236d9d7eb8f9214489f8482378263050aab88e68a44ca8d4b6ed3f96b457979'
    )
    expect(toHex(storeToIpfsPayload(cid, 70000))).toBe(
      '0x0a2401551220a236d9d7eb8f9214489f8482378263050aab88e68a44ca8d4b6ed3f96b45797910f0a204'
    )
    expect(() =>
      cidBytes('QmYQEa2YYEcFRAnxuaVS5jBYKPQQFricdTHjtDMr3Ma2M3')
    ).toThrow()
  })
})

describe('preparing', () => {
  it('estimates a like with the node and doubles the fee as the most it may cost', async () => {
    const node = scriptedNode({
      dna_getCoinbaseAddr: me,
      contract_estimateCall: {success: true, txFee: '17.4', gasCost: '146.33'},
    })
    const like = SocialCall.post(makePostArgument(LIKE, PostTarget.onPost(3)))
    const pending = await prepareCall(node.call, like)
    expect(node.methods()).toEqual([
      'dna_getCoinbaseAddr',
      'contract_estimateCall',
    ])
    expect(node.calls[1].params).toEqual([
      {
        from: me,
        contract: SOCIAL_CONTRACT,
        method: 'makePost',
        amount: '0.00001',
        args: [
          {
            index: 0,
            format: 'string',
            value: '{"message":"❤️","replyToPostId":"3"}',
          },
        ],
      },
    ])
    expect(fromWei(pending.fee.fee, 2)).toBe('163.73')
    expect(fromWei(pending.fee.maxFee, 6)).toBe('327.460000')
    expect(totalFee(pending)).toBe(pending.fee.fee)
  })

  it("passes on the contract's refusal", async () => {
    const node = scriptedNode({
      contract_estimateCall: {success: false, error: 'non-existent post'},
    })
    await expect(
      estimateCall(node.call, me, SocialCall.tip(99, 1))
    ).rejects.toThrow('non-existent post')
    const silent = scriptedNode({contract_estimateCall: {success: false}})
    await expect(
      estimateCall(silent.call, me, SocialCall.tip(99, 1))
    ).rejects.toThrow('the contract refused the post')
  })

  it('stores the text and the image before a post, and checks the balance', async () => {
    const node = scriptedNode({
      dna_getCoinbaseAddr: me,
      ipfs_cid: ([data]) => (data === hex('long text') ? 'btext' : 'bimage'),
      bcn_estimateTx: {txFee: '0.5'},
      contract_estimateCall: {success: true, txFee: '1', gasCost: '0.5'},
      dna_getBalance: {balance: '10'},
    })
    const pending = await prepareDraft(node.call, {
      text: '  long text ',
      textOnIpfs: true,
      image: Uint8Array.from([1, 2, 3]),
      target: PostTarget.onReply(7),
    })
    expect(node.methods()).toEqual([
      'dna_getCoinbaseAddr',
      'ipfs_cid',
      'bcn_estimateTx',
      'ipfs_cid',
      'bcn_estimateTx',
      'contract_estimateCall',
      'dna_getBalance',
    ])
    expect(node.calls[2].params[0].type).toBe(STORE_TO_IPFS_TX)
    expect(pending.files.map(({what, cid}) => [what, cid])).toEqual([
      ['text', 'btext'],
      ['image', 'bimage'],
    ])
    expect(pending.socialCall.argument).toBe(
      '{"message":"ipfs://btext","replyToPostId":"7","channelId":"discuss:7","media":["ipfs://bimage"],"mediaType":["image/webp"]}'
    )
    expect(fromWei(totalFee(pending), 2)).toBe('2.50')

    const poor = scriptedNode({
      dna_getCoinbaseAddr: me,
      contract_estimateCall: {success: true, txFee: '1', gasCost: '0.5'},
      dna_getBalance: {balance: '2.999'},
    })
    await expect(
      prepareDraft(poor.call, {text: 'hi', target: PostTarget.newPost()})
    ).rejects.toThrow('up to 3.01 iDNA needed, the balance is 2.99')
  })

  it('refuses a file over 900 KB and does not pay twice for a stored one', async () => {
    const node = scriptedNode({
      dna_getCoinbaseAddr: me,
      ipfs_cid: 'bimage',
      contract_estimateCall: {success: true, txFee: '1', gasCost: '0'},
      dna_getBalance: {balance: '10'},
    })
    await expect(
      prepareDraft(node.call, {
        text: '',
        image: new Uint8Array(900001),
        target: PostTarget.newPost(),
      })
    ).rejects.toThrow('the image is too large (900 KB, at most 900 KB)')
    const pending = await prepareDraft(
      node.call,
      {text: '', image: Uint8Array.from([1]), target: PostTarget.newPost()},
      new Set(['bimage'])
    )
    expect(pending.files[0]).toMatchObject({stored: true, fee: BigInt(0)})
    expect(node.methods()).not.toContain('bcn_estimateTx')
  })
})

describe('sending', () => {
  it('stores each new file, then sends the call with its max fee', async () => {
    const node = scriptedNode({
      ipfs_add: ([data]) => (data === '0x01' ? 'bone' : 'btwo'),
      dna_storeToIpfs: '0xstore',
      contract_call: '0xcall',
    })
    const files = []
    const stored = []
    const hash = await sendPrepared(
      node.call,
      {
        from: me,
        socialCall: SocialCall.tip(3, 2),
        fee: {fee: toWei('1'), maxFee: toWei('2.5')},
        files: [
          {what: 'text', bytes: Uint8Array.from([1]), cid: 'bone'},
          {
            what: 'image',
            bytes: Uint8Array.from([2]),
            cid: 'bold',
            stored: true,
          },
        ],
      },
      {onFile: (what) => files.push(what), onStored: (cid) => stored.push(cid)}
    )
    expect(hash).toBe('0xcall')
    expect(node.methods()).toEqual([
      'ipfs_add',
      'dna_storeToIpfs',
      'contract_call',
    ])
    expect(node.calls[0].params).toEqual(['0x01', true])
    expect(node.calls[2].params[0]).toMatchObject({
      method: 'sendTip',
      amount: '2',
      maxFee: '2.500000',
    })
    expect(files).toEqual(['text'])
    expect(stored).toEqual(['bone'])
  })

  it('stops when the node stores a file under another CID', async () => {
    const node = scriptedNode({ipfs_add: 'bother'})
    await expect(
      sendPrepared(node.call, {
        from: me,
        socialCall: SocialCall.tip(3, 2),
        fee: {fee: BigInt(1), maxFee: BigInt(2)},
        files: [{what: 'image', bytes: Uint8Array.from([1]), cid: 'bmine'}],
      })
    ).rejects.toThrow('the node stored the image under another CID (bother)')
    expect(node.methods()).toEqual(['ipfs_add'])
  })
})

describe('waiting for the block', () => {
  const run = (answers) => {
    const node = scriptedNode(answers)
    const pauses = []
    return waitForBlock(node.call, '0xhash', {
      pause: async (ms) => pauses.push(ms),
      isStopped: () => pauses.length > 20,
    }).then((outcome) => ({outcome, node, pauses}))
  }

  it('waits until the transaction is in a block', async () => {
    let lookups = 0
    const {outcome, pauses} = await run({
      bcn_transaction: () => {
        lookups += 1
        return {blockHash: lookups < 3 ? `0x${'0'.repeat(64)}` : '0x12ab'}
      },
      bcn_txReceipt: {success: true},
    })
    expect(outcome).toEqual({result: 'mined', error: null})
    expect(pauses).toEqual([10000, 10000])
  })

  it('tells when the contract refused the mined call', async () => {
    const {outcome} = await run({
      bcn_transaction: {blockHash: '0x12ab'},
      bcn_txReceipt: {success: false, error: 'cannot tip more than sent'},
    })
    expect(outcome).toEqual({
      result: 'mined',
      error: 'cannot tip more than sent',
    })
  })

  it('gives up once the node no longer knows the transaction', async () => {
    let lookups = 0
    const {outcome, pauses} = await run({
      bcn_transaction: () => {
        lookups += 1
        if (lookups === 2) throw new Error('connection refused')
        return lookups === 1 ? {blockHash: `0x${'0'.repeat(64)}`} : null
      },
    })
    expect(outcome).toEqual({result: 'dropped'})
    // Seen, a failed lookup, then three lookups that find nothing.
    expect(pauses).toHaveLength(4)
  })
})
