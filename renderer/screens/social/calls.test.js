import {
  callsToActivity,
  ipfsCid,
  nextPageToken,
  parsePost,
  parseTip,
  postAuthors,
  validTipAmount,
} from './calls'
import {MAX_INLINE_MEDIA} from './contract'
import {postIds} from './feed'
import {a, b, call, hex} from './test-helpers'
import {SOCIAL_VERSIONS} from './versions'

// Ported from the phone app's SocialTest.kt: both apps read idena.social the same way.

describe('reading the calls', () => {
  it('reads the argument idena.social sends', () => {
    const parsed = parsePost(
      call(
        '{"message":"hi","replyToPostId":"5","media":["AAAA"],"mediaType":["image/png"]}'
      )
    )
    expect(parsed).toMatchObject({
      hash: '0x01',
      height: 7,
      time: 1000,
      index: 2,
      message: 'hi',
      replyTo: '5',
      channel: '',
      hasMedia: true,
      author: a,
    })
    expect(parsePost(call('{"message":"x","media":["AAAA"]}')).hasMedia).toBe(
      false
    )
    expect(parsePost(call('hello'))).toBeNull()
    expect(parsePost(call('[1]'))).toBeNull()
    expect(parsePost({...call('{}'), args: []})).toBeNull()
  })

  it('keeps the first media', () => {
    const onIpfs = parsePost(
      call(
        '{"message":"","media":["ipfs://bafkreiabc123","x"],"mediaType":["image/png","image/gif"]}'
      )
    )
    expect(onIpfs.media).toBe('ipfs://bafkreiabc123')
    expect(onIpfs.mediaType).toBe('image/png')
    const big = 'A'.repeat(MAX_INLINE_MEDIA + 1)
    const tooLarge = parsePost(
      call(`{"message":"","media":["${big}"],"mediaType":["image/png"]}`)
    )
    expect(tooLarge.hasMedia).toBe(true)
    expect(tooLarge.media).toBe('')
  })

  it('reads tips and keeps posts and tips apart', () => {
    const parsed = parseTip(
      call('{"postId":"102","tipAmount":"5"}', {
        method: 'sendTip',
        from: '0xAB',
        amount: '5',
      })
    )
    expect(parsed).toMatchObject({
      postId: '102',
      tipAmount: '5',
      amount: '5',
      from: '0xab',
    })
    expect(validTipAmount(parsed)).toBe(5)

    const {posts, tips} = callsToActivity([
      call('{"message":"hi"}'),
      call('{"postId":"1","tipAmount":"2"}', {method: 'sendTip', amount: '2'}),
      call('{"message":"x"}', {method: 'sendMessage'}),
      call('not json'),
    ])
    expect(posts.map((p) => p.message)).toEqual(['hi'])
    expect(tips.map((t) => t.postId)).toEqual(['1'])
  })

  it('leaves out the calls the node marks as refused', () => {
    const {posts, tips} = callsToActivity([
      call('{"message":"accepted"}', {success: true}),
      call('{"message":"refused"}', {success: false}),
      call('{"message":"from a node without the mark"}'),
      call('{"postId":"1","tipAmount":"2"}', {
        method: 'sendTip',
        amount: '2',
        success: false,
      }),
    ])
    expect(posts.map((p) => p.message)).toEqual([
      'accepted',
      'from a node without the mark',
    ])
    expect(tips).toEqual([])
  })

  it('fetches only plain IPFS ids', () => {
    expect(
      ipfsCid(
        'ipfs://bafkreifcg3m5p24psikerh4eqi3yeyyfbkvyrzukitfi2s3o2p4wwrlzpe'
      )
    ).toBe('bafkreifcg3m5p24psikerh4eqi3yeyyfbkvyrzukitfi2s3o2p4wwrlzpe')
    expect(ipfsCid('ipfs://../../node/datadir/keystore')).toBeNull()
    expect(ipfsCid('ipfs://bafk rei')).toBeNull()
    expect(ipfsCid('bafkreifcg3m5p24psikerh4eqi3yeyyfb')).toBeNull()
    expect(ipfsCid('ipfs://')).toBeNull()
    expect(ipfsCid(undefined)).toBeNull()
  })
})

describe('the contract map', () => {
  it('gives the post authors', () => {
    // An item of contract_iterateMap(idena.social, "p:", ..., "hex", "hex") on mainnet: post 1.
    const items = [
      {
        key: '0x01000000000000000000000000000000',
        value:
          '0x307862313262313232326430636537306430336264393834613836316338323561383661633637383938',
      },
      {key: '0x66000000000000000000000000000000', value: hex('0xABC')},
      {key: '0x00010000000000000000000000000000', value: hex('0xdef')},
    ]
    expect(postAuthors(items)).toEqual({
      1: '0xb12b1222d0ce70d03bd984a861c825a86ac67898',
      102: '0xabc',
      256: '0xdef',
    })
  })

  it('ends at the last page', () => {
    expect(nextPageToken('0x703a65000000000000000000000000000000')).toBe(
      '0x703a65000000000000000000000000000000'
    )
    expect(nextPageToken('0x')).toBeNull()
    expect(nextPageToken('')).toBeNull()
    expect(nextPageToken(null)).toBeNull()
  })
})

describe('the older contract versions', () => {
  const v1 = SOCIAL_VERSIONS.find(({name}) => name === 'v1')
  const v5 = SOCIAL_VERSIONS.find(({name}) => name === 'v5')
  const v9 = SOCIAL_VERSIONS.find(({name}) => name === 'v9')
  const v11 = SOCIAL_VERSIONS.find(({name}) => name === 'v11')

  it('reads the replies of v1 and v5, written as hex or decimal ids', () => {
    // As written on chain in December 2025: the 16 bytes of a little-endian u128.
    const hexReply = parsePost(
      call(
        '{"message":"Hello Hello","replyToPostId":"0x2e000000000000000000000000000000"}'
      ),
      v1
    )
    expect(hexReply).toMatchObject({version: 'v1', replyTo: '46'})
    expect(
      parsePost(call('{"message":"Hi","replyToPostId":"0x2e"}'), v1).replyTo
    ).toBe('46')
    expect(
      parsePost(call('{"message":"Hi","replyToPostId":"99"}'), v1).replyTo
    ).toBe('99')
    // Their media fields were never used; a post without a message failed.
    expect(
      parsePost(
        call(
          '{"message":"Hi","media":["ipfs://bafy"],"mediaType":["image/png"]}'
        ),
        v1
      ).hasMedia
    ).toBe(false)
    expect(parsePost(call('{"message":""}'), v1)).toBeNull()
    // The current contract keeps no version name.
    expect(parsePost(call('{"message":"Hi"}'))).not.toHaveProperty('version')
  })

  it('reads the tips of each version', () => {
    // v1 and v5: the post id as plain text, the tip is all that was sent.
    const plain = parseTip(
      call('', {method: 'sendTip', args: [hex('12')], amount: '2.5'}),
      v1
    )
    expect(plain).toMatchObject({version: 'v1', postId: '12', sent: true})
    expect(validTipAmount(plain)).toBe(2.5)
    expect(
      parseTip(call('', {method: 'sendTip', args: [hex('{"x":1}')]}), v1)
    ).toBeNull()
    // v9 and v10: {postId}, the tip is all that was sent.
    const sent = parseTip(
      call('{"postId":"7"}', {method: 'sendTip', amount: '100'}),
      v9
    )
    expect(sent).toMatchObject({postId: '7', sent: true})
    expect(validTipAmount(sent)).toBe(100)
    expect(validTipAmount({...sent, amount: '0'})).toBeNull()
    // v11 as v12: whole iDNA, no more than sent.
    const whole = parseTip(
      call('{"postId":"7","tipAmount":"5"}', {method: 'sendTip', amount: '5'}),
      v11
    )
    expect(whole).not.toHaveProperty('sent')
    expect(validTipAmount(whole)).toBe(5)
    const {posts, tips} = callsToActivity(
      [
        call('{"message":"Hi"}'),
        call('', {method: 'sendTip', args: [hex('1')], amount: '1'}),
      ],
      v1
    )
    expect(posts.map(({version}) => version)).toEqual(['v1'])
    expect(tips.map(({postId}) => postId)).toEqual(['1'])
  })

  it('read the tips paid from the tips balance, in the unit of each version', () => {
    const fromBalance = (tipAmount, version) =>
      parseTip(
        call(`{"postId":"76","tipAmount":"${tipAmount}"}`, {
          method: 'sendTipFromBalance',
          amount: '0',
        }),
        version
      )
    // v1: whole iDNA.
    const whole = fromBalance('2', v1)
    expect(whole).toMatchObject({postId: '76', fromBalance: true})
    expect(whole).not.toHaveProperty('sent')
    expect(validTipAmount(whole)).toBe(2)
    // v5: its smallest unit, 10^-18 iDNA.
    expect(validTipAmount(fromBalance('1200000000000000000', v5))).toBe(1.2)
    expect(validTipAmount(fromBalance('500000000000000000000', v5))).toBe(500)
    expect(fromBalance('1', v5).tipAmount).toBe('0.000000000000000001')
    expect(validTipAmount(fromBalance('0', v5))).toBeNull()
    expect(fromBalance('1.5', v5)).toBeNull()
    // Later versions have no such method.
    expect(fromBalance('1', v9)).toBeNull()
    expect(fromBalance('1')).toBeNull()
    expect(
      callsToActivity(
        [
          call('{"postId":"76","tipAmount":"3"}', {
            method: 'sendTipFromBalance',
          }),
        ],
        v1
      ).tips.map(validTipAmount)
    ).toEqual([3])
  })

  it('leave a refused first try out, so that its retry keeps its number', () => {
    // As on chain in v1 and v5: a refused post, then the same author's retry.
    const calls = [
      call('{"message":"first"}', {hash: 'p1', height: 100, from: a}),
      call('{"message":"try","replyToPostId":"1"}', {
        hash: 'try',
        height: 110,
        from: b,
        success: false,
      }),
      call('{"message":"retry","replyToPostId":"1"}', {
        hash: 'p2',
        height: 120,
        from: b,
        success: true,
      }),
      call('{"message":"next"}', {hash: 'p3', height: 130, from: b}),
    ]
    const authors = {1: a, 2: b, 3: b}
    const numbered = (list) => [
      ...postIds(callsToActivity(list, v5).posts, authors, {fromOldest: true}),
    ]
    expect(numbered(calls)).toEqual([
      ['p1', 1],
      ['p2', 2],
      ['p3', 3],
    ])
    // Without the node's mark, the refused try takes the retry's number and the next post the one after.
    expect(numbered(calls.map(({success, ...rest}) => rest))).toEqual([
      ['p1', 1],
      ['try', 2],
      ['p2', 3],
    ])
  })
})
