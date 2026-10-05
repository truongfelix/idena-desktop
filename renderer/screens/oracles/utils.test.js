import {TextEncoder, TextDecoder} from 'util'

jest.mock('../../shared/utils/utils', () => ({
  ...jest.requireActual('../../shared/utils/utils'),
  callRpc: jest.fn(),
}))

const {callRpc} = require('../../shared/utils/utils')
const {
  buildDynamicArgs,
  buildContractDeploymentArgs,
  fetchVotings,
  fetchLastOpenVotings,
  fetchContractBalanceUpdates,
} = require('./utils')

describe('buildDynamicArgs', () => {
  it('should filter nullish values out', () => {
    expect(
      buildDynamicArgs([{value: null}, {value: undefined}, {foo: 'bar'}, {}])
    ).toHaveLength(0)
    expect(
      buildDynamicArgs([
        {value: null},
        {value: undefined},
        {foo: ''},
        {value: 0},
        {value: ''},
        {},
      ])
    ).toHaveLength(2)
    expect(
      buildDynamicArgs([{value: 1}, {value: 2}, {foo: 'bar'}, {}])
    ).toHaveLength(2)
    expect(
      buildDynamicArgs([{value: 0}, {value: false}, {value: ''}, {}])
    ).toHaveLength(3)
  })
})

describe('buildDeploymentArgs', () => {
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder

  describe('winnerThreshold', () => {
    it('should set default winnerThreshold', () => {
      expect(
        buildContractDeploymentArgs(
          {
            title: 'title',
          },
          {from: '0x0', stake: 100, gasCost: 0, txFee: 0}
        ).args.find(({index}) => index === 4)
      ).toHaveProperty('value', '66')
    })

    it('should not replace 0 with default', () => {
      expect(
        buildContractDeploymentArgs(
          {
            title: 'title',
            winnerThreshold: 0,
          },
          {from: '0x0', stake: 100, gasCost: 0, txFee: 0}
        ).args.find(({index}) => index === 4)
      ).toHaveProperty('value', '0')
    })

    it('should respect valid value', () => {
      ;[10, 22, 33, 51, 65, 77, 99].forEach((v) =>
        expect(
          buildContractDeploymentArgs(
            {
              title: 'title',
              winnerThreshold: v,
            },
            {from: '0x0', stake: 100, gasCost: 0, txFee: 0}
          ).args.find(({index}) => index === 4)
        ).toHaveProperty('value', String(v))
      )
    })
  })
})

describe('votings from the node', () => {
  beforeEach(() => callRpc.mockReset())

  it("asks the oracle's committees with the states as a list", async () => {
    callRpc.mockResolvedValue({
      result: [{contractAddress: '0x1'}],
      continuationToken: 't',
    })
    const res = await fetchVotings({
      oracle: '0xa',
      'states[]': 'Open,Voted',
      continuationToken: 'c',
    })
    expect(callRpc).toHaveBeenCalledWith('contract_oracleVotings', {
      oracle: '0xa',
      states: ['Open', 'Voted'],
      limit: 20,
      continuationToken: 'c',
    })
    expect(res).toEqual({
      result: [{contractAddress: '0x1'}],
      continuationToken: 't',
    })
  })

  it('asks the votings the address created or voted in for My votings', async () => {
    callRpc.mockResolvedValue({})
    const res = await fetchVotings({
      all: true,
      own: true,
      oracle: '0xa',
      'states[]': 'Open',
    })
    expect(callRpc).toHaveBeenCalledWith('contract_oracleVotings', {
      address: '0xa',
      limit: 20,
    })
    expect(res.result).toBeUndefined()
  })

  it('leaves no list when nothing matches, as the badge expects', async () => {
    callRpc.mockResolvedValue({})
    expect(
      await fetchLastOpenVotings({oracle: '0xa', limit: 1})
    ).toBeUndefined()
  })

  it('gives an empty list of balance updates when there are none', async () => {
    callRpc.mockResolvedValue({})
    expect(
      await fetchContractBalanceUpdates({
        address: '0xa',
        contractAddress: '0xc',
      })
    ).toEqual([])
    expect(callRpc).toHaveBeenCalledWith(
      'contract_oracleVotingBalanceUpdates',
      {
        address: '0xa',
        contract: '0xc',
        limit: 50,
      }
    )
  })
})
