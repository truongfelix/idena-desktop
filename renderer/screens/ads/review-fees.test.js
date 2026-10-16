import {TextEncoder, TextDecoder} from 'util'
import {TxType} from '../../shared/types'

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

const {estimateReviewFees} = require('./review-fees')

const ME = '0x79259fd77ed6c2cdac837772b86f0a5f25bad16d'
const AD_CID = 'bafkreih34kgwthexieormfjjoehhnf63xmdlicjlsmhmdnmcslshpuytfi'

// A node answering estimates as the devnet's; `calls` records what was asked.
function fakeNode({deployError} = {}) {
  const calls = []
  const answers = {
    ipfs_cid: () => AD_CID,
    bcn_estimateTx: () => ({txFee: '41.2'}),
    contract_estimateDeploy: () =>
      deployError
        ? {error: deployError}
        : {txFee: '12.5', gasCost: '151.856', contract: '0xc'},
  }
  const call = jest.fn(async (method, params) => {
    calls.push([method, params])
    return answers[method](params)
  })
  return {call, calls}
}

describe('ad review fees', () => {
  it('adds storing the ad and deploying its voting', async () => {
    const {call} = fakeNode()
    const fees = await estimateReviewFees(call, {
      from: ME,
      adHex: '0x0a0b0c',
      title: 'Devnet test ad',
      stake: 30000,
    })
    expect(fees).toEqual({
      storeFee: '41.200000',
      deployFee: '164.356000',
      total: '205.556000',
    })
  })

  it('estimates the storage of the ad as it is and the voting on its cid', async () => {
    const {call, calls} = fakeNode()
    await estimateReviewFees(call, {
      from: ME,
      adHex: '0a0b0c',
      title: 'Devnet test ad',
      stake: 30000,
    })
    expect(calls[0]).toEqual(['ipfs_cid', ['0x0a0b0c']])
    const [, [store]] = calls.find(([method]) => method === 'bcn_estimateTx')
    expect(store).toMatchObject({type: TxType.StoreToIpfsTx, from: ME})
    const [, [deploy]] = calls.find(
      ([method]) => method === 'contract_estimateDeploy'
    )
    expect(deploy).toMatchObject({from: ME, amount: 30000})
    const fact = JSON.parse(
      Buffer.from(deploy.args[0].value.slice(2), 'hex').toString()
    )
    expect(fact).toMatchObject({
      title: 'Is this ad appropriate?',
      adCid: AD_CID,
    })
  })

  it('says why when the node refuses the deploy', async () => {
    const {call} = fakeNode({deployError: 'insufficient funds'})
    await expect(
      estimateReviewFees(call, {
        from: ME,
        adHex: '0x0a',
        title: 'Ad',
        stake: 30000,
      })
    ).rejects.toThrow('insufficient funds')
  })
})
