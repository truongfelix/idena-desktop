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
  mapVoting,
  votingFact,
  isKnownAmount,
  withTimeout,
  pollTransaction,
} = require('./utils')

const {HASH_IN_MEMPOOL} = jest.requireActual('../../shared/utils/utils')

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

const factHex = (value) =>
  `0x${Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value)
  ).toString('hex')}`

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

describe('votingFact', () => {
  it('reads the fields the app writes', () => {
    const fact = {
      title: 'Title',
      desc: 'Desc',
      options: [
        {id: 0, value: 'yes'},
        {id: 1, value: 'no'},
      ],
      adCid: 'bafy',
    }
    expect(votingFact(factHex(fact))).toEqual(fact)
  })

  it('leaves out text fields of other types', () => {
    expect(
      votingFact(
        factHex({
          title: {text: 'object'},
          desc: ['array'],
          options: 'not a list',
          adCid: 5,
        })
      )
    ).toEqual({title: '', desc: '', options: []})
  })

  it('keeps only options with a text and an id', () => {
    expect(
      votingFact(
        factHex({
          options: [
            {id: 0, value: 'yes'},
            null,
            'no',
            {id: 2, value: {text: 'object'}},
            {value: 'no id'},
            {id: '3', value: 'text id'},
          ],
        })
      ).options
    ).toEqual([
      {id: 0, value: 'yes'},
      {id: '3', value: 'text id'},
    ])
  })

  it('gives an untitled voting for facts that are not an object', () => {
    for (const fact of [
      factHex('null'),
      factHex('[1, 2]'),
      factHex('"text"'),
      factHex('{broken'),
      '0x',
      null,
      undefined,
    ]) {
      expect(votingFact(fact)).toEqual({title: '', desc: '', options: []})
    }
  })
})

describe('mapVoting', () => {
  it('keeps what the node reports when the fact names the same fields', () => {
    const voting = mapVoting({
      contractAddress: '0xbb',
      author: '0x01',
      state: 'Open',
      fact: factHex({
        title: 'Title',
        id: '0xaa',
        contractHash: '0xaa',
        status: 'Archived',
        issuer: '0x02',
        rewardsFund: 1000,
      }),
    })
    expect(voting).toMatchObject({
      id: '0xbb',
      contractHash: '0xbb',
      status: 'Open',
      issuer: '0x01',
      rewardsFund: 0,
      title: 'Title',
    })
  })
})

describe('isKnownAmount', () => {
  it('tells amounts from missing values', () => {
    expect([0, '0', 12.5, '12.5'].every(isKnownAmount)).toBe(true)
    expect(
      [undefined, null, '', 'abc', NaN, Infinity].some(isKnownAmount)
    ).toBe(false)
  })
})

describe('withTimeout', () => {
  afterEach(() => jest.useRealTimers())

  it('passes the answer on', async () => {
    await expect(withTimeout(Promise.resolve(1), 1000, 'late')).resolves.toBe(1)
  })

  it('rejects when there is no answer in time', async () => {
    jest.useFakeTimers()
    const pending = withTimeout(new Promise(() => {}), 1000, 'late')
    jest.advanceTimersByTime(1000)
    await expect(pending).rejects.toThrow('late')
  })
})

describe('pollTransaction', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  // Runs the poll timer and the RPC answer behind it.
  async function poll() {
    jest.advanceTimersByTime(10 * 1000)
    await Promise.resolve()
    await Promise.resolve()
  }

  it('sends mined once the transaction is in a block', async () => {
    callRpc
      .mockResolvedValueOnce({blockHash: HASH_IN_MEMPOOL})
      .mockResolvedValueOnce({blockHash: '0xblock'})
    const send = jest.fn()
    pollTransaction('0xtx', send)
    await poll()
    expect(send).not.toHaveBeenCalled()
    await poll()
    expect(send).toHaveBeenCalledWith('MINED')
    expect(callRpc).toHaveBeenCalledWith('bcn_transaction', '0xtx')
  })

  it('sends dropped after the node did not know it 3 times in a row', async () => {
    callRpc
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({blockHash: HASH_IN_MEMPOOL})
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const send = jest.fn()
    const dropped = {type: 'TX_NULL', data: {message: 'dropped'}}
    pollTransaction('0xtx', send, {dropped})
    for (let i = 0; i < 4; i += 1) await poll()
    expect(send).not.toHaveBeenCalled()
    await poll()
    expect(send).toHaveBeenCalledWith(dropped)
  })

  it('polls again after a failed poll', async () => {
    callRpc
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({blockHash: '0xblock'})
    const send = jest.fn()
    pollTransaction('0xtx', send)
    for (let i = 0; i < 3; i += 1) await poll()
    expect(send).not.toHaveBeenCalled()
    await poll()
    expect(send).toHaveBeenCalledWith('MINED')
  })

  it('stops polling on cleanup', async () => {
    callRpc.mockResolvedValue({blockHash: HASH_IN_MEMPOOL})
    const stop = pollTransaction('0xtx', jest.fn())
    stop()
    await poll()
    expect(callRpc).not.toHaveBeenCalled()
  })
})
