// The calls, posts and tips the Social tests build.

export const a = '0xaaaa000000000000000000000000000000000001'
export const b = '0xbbbb000000000000000000000000000000000002'
export const c = '0xcccc000000000000000000000000000000000003'

export const hex = (text) => `0x${Buffer.from(text, 'utf8').toString('hex')}`

export const call = (arg, extra = {}) => ({
  hash: '0x01',
  height: 7,
  timestamp: 1000,
  index: 2,
  from: '0xAAAA000000000000000000000000000000000001',
  amount: '0.00001',
  method: 'makePost',
  args: [hex(arg)],
  ...extra,
})

export function post(
  hash,
  author,
  message,
  time,
  {replyTo = '', channel = '', height = time, index = 0, hasMedia = false} = {}
) {
  return {
    hash,
    height,
    time,
    index,
    author,
    message,
    replyTo,
    channel,
    hasMedia,
    media: '',
    mediaType: '',
  }
}

export const tip = (
  hash,
  from,
  postId,
  tipAmount,
  amount,
  height,
  index = 0
) => ({
  hash,
  height,
  time: height,
  index,
  from,
  postId,
  tipAmount,
  amount,
})

export const authorsOf = (posts) =>
  Object.fromEntries(posts.map((p, i) => [i + 1, p.author]))
