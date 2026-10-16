import {TextEncoder, TextDecoder} from 'util'
import {ChangeProfileAttachment} from '../../shared/models/changeProfileAttachment'
import {Profile} from '../../shared/models/profile'
import {TxType} from '../../shared/types'

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

const {planAdRemoval, profileWithout, sendAdRemoval} = require('./remove-ad')

const ME = '0x79259fd77ed6c2cdac837772b86f0a5f25bad16d'
const EMPTY = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const NEW_PROFILE =
  'bafkreielmxj4ntwetyn4sen7os2uqk4ecfjun7ild5uovvr5twaotvnp64'

// The devnet god's profile (2026-10-16): two entries with one cid and their own votings, then campaign A.
const entry = (cid, contract) => ({
  cid,
  target: '0a02656e',
  contract,
  author: ME,
})
const ctl1 = entry(EMPTY, '0x63746c315f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f')
const ctl2 = entry(EMPTY, '0x63746c325f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f')
const campaignA = entry(
  'bafkreiezdlhwz6n6uk7chptf25wmafkgt4apyn2pq2j53ni3k65rmsfqye',
  '0x7265616c315f5f5f5f5f5f5f5f5f5f5f5f5f5f5f'
)

// A node answering as the devnet's; `calls` records what was asked.
function fakeNode({ads = [ctl1, ctl2, campaignA], added = NEW_PROFILE} = {}) {
  const calls = []
  const answers = {
    dna_identity: () => ({profileHash: 'bafyprofile'}),
    ipfs_get: () => `0x${new Profile({ads}).toHex()}`,
    ipfs_cid: () => NEW_PROFILE,
    bcn_estimateTx: ([{type}]) => ({
      txFee: type === TxType.StoreToIpfsTx ? '0.012' : '0.0035',
    }),
    ipfs_add: () => added,
    dna_storeToIpfs: () => '0xstore',
    dna_sendTransaction: () => '0xchange',
  }
  const call = jest.fn(async (method, params) => {
    calls.push([method, params])
    return answers[method](params)
  })
  return {call, calls}
}

describe('take a campaign out of the profile', () => {
  it('keeps every other entry, the ones sharing its cid included', () => {
    expect(profileWithout([ctl1, ctl2, campaignA], ctl2)).toEqual([
      ctl1,
      campaignA,
    ])
  })

  it('plans the profile without it, with both fees', async () => {
    const {call, calls} = fakeNode()
    const plan = await planAdRemoval(call, ME, campaignA)
    expect(Profile.fromHex(plan.profileHex).ads).toEqual([ctl1, ctl2])
    expect(plan.profileCid).toBe(NEW_PROFILE)
    expect(plan.fee).toBe('0.015500')
    const [, [changeEstimate]] = calls.find(
      ([method, [args]]) =>
        method === 'bcn_estimateTx' && args.type === TxType.ChangeProfileTx
    )
    expect(changeEstimate.from).toBe(ME)
  })

  it('plans an empty profile when it was the last campaign, with no storage', async () => {
    const {call, calls} = fakeNode({ads: [campaignA]})
    const plan = await planAdRemoval(call, ME, campaignA)
    expect(plan.profileHex).toBe('0x')
    expect(Profile.fromHex(plan.profileHex).ads).toEqual([])
    // The node refuses to store 0 bytes (its estimate said ~21,000 iDNA on a devnet): only the change is paid.
    expect(plan.fee).toBe('0.003500')
    const estimated = calls
      .filter(([method]) => method === 'bcn_estimateTx')
      .map(([, [args]]) => args.type)
    expect(estimated).toEqual([TxType.ChangeProfileTx])
  })

  it('sends only the change for an empty profile', async () => {
    const {call, calls} = fakeNode({ads: [campaignA]})
    const plan = await planAdRemoval(call, ME, campaignA)
    await expect(sendAdRemoval(call, plan)).resolves.toBe('0xchange')
    const sent = calls.map(([method]) => method)
    expect(sent).not.toContain('ipfs_add')
    expect(sent).not.toContain('dna_storeToIpfs')
    const [, [tx]] = calls[calls.length - 1]
    expect(tx.type).toBe(TxType.ChangeProfileTx)
  })

  it('refuses a campaign the profile does not list', async () => {
    const {call} = fakeNode({ads: [ctl1]})
    await expect(planAdRemoval(call, ME, campaignA)).rejects.toThrow(
      'your profile does not list this campaign'
    )
  })

  it('stores the new profile, then sends the change to its cid', async () => {
    const {call, calls} = fakeNode()
    const plan = await planAdRemoval(call, ME, campaignA)
    await expect(sendAdRemoval(call, plan)).resolves.toBe('0xchange')
    const sent = calls.slice(-3).map(([method]) => method)
    expect(sent).toEqual(['ipfs_add', 'dna_storeToIpfs', 'dna_sendTransaction'])
    const [, [tx]] = calls[calls.length - 1]
    expect(tx.type).toBe(TxType.ChangeProfileTx)
    expect(ChangeProfileAttachment.fromHex(tx.payload).cid).toBeTruthy()
  })

  it('sends nothing when IPFS gives the profile another cid', async () => {
    const {call, calls} = fakeNode({added: 'bafyother'})
    const plan = await planAdRemoval(call, ME, campaignA)
    await expect(sendAdRemoval(call, plan)).rejects.toThrow('another cid')
    expect(calls.map(([method]) => method)).not.toContain('dna_sendTransaction')
  })
})
