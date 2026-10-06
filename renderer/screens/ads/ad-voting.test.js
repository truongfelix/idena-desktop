import {TextEncoder, TextDecoder} from 'util'

jest.mock('../../shared/utils/utils', () => ({
  ...jest.requireActual('../../shared/utils/utils'),
  callRpc: jest.fn(),
}))
jest.mock('../../shared/utils/dexieDb', () => {
  const rows = new Map()
  return {
    saved: rows,
    dexieDb: {
      table: () => ({
        get: (address) => Promise.resolve(rows.get(address)),
        put: (voting) => {
          rows.set(voting.address, voting)
          return Promise.resolve()
        },
      }),
    },
  }
})

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

const {callRpc} = require('../../shared/utils/utils')
const {saved} = require('../../shared/utils/dexieDb')
const {
  adVotingDefaults,
  getAdVoting,
  isApprovedVoting,
  isRejectedVoting,
} = require('./utils')
const {VotingStatus} = require('../../shared/types')

const factHex = (value) =>
  `0x${Buffer.from(JSON.stringify(value)).toString('hex')}`

const reviewFact = {
  title: adVotingDefaults.title,
  desc: 'An ad',
  options: adVotingDefaults.options,
  adCid: 'bafyad',
}

// The contract's data for a finished voting (state 2) that ended on option `result`.
function finished(fact, result = 0) {
  callRpc.mockResolvedValueOnce([
    {key: 'state', value: 2},
    {key: 'fact', value: factHex(fact)},
    {key: 'result', value: result},
  ])
}

let contract = 0
const nextContract = () => {
  contract += 1
  return `0xc${contract}`
}

afterEach(() => jest.clearAllMocks())

describe('ad voting', () => {
  it('approves an ad review that ended on Approve', async () => {
    finished(reviewFact, 0)
    const voting = await getAdVoting(nextContract())
    expect(voting).toMatchObject({
      status: VotingStatus.Archived,
      title: adVotingDefaults.title,
      adCid: 'bafyad',
      result: 0,
    })
    expect(isApprovedVoting(voting)).toBe(true)
    expect(isRejectedVoting(voting)).toBe(false)
  })

  it('rejects an ad review that ended on Reject', async () => {
    finished(reviewFact, 1)
    const voting = await getAdVoting(nextContract())
    expect(isApprovedVoting(voting)).toBe(false)
    expect(isRejectedVoting(voting)).toBe(true)
  })

  it('neither approves nor rejects a voting whose options are not a list', async () => {
    for (const options of ['Approve', 5, {0: 'Approve'}, null]) {
      finished({...reviewFact, options}, 0)
      // eslint-disable-next-line no-await-in-loop
      const voting = await getAdVoting(nextContract())
      expect(voting.options).toEqual([])
      expect(isApprovedVoting(voting)).toBe(false)
      expect(isRejectedVoting(voting)).toBe(false)
    }
  })

  it('keeps the status and result of the contract when the fact names them', async () => {
    callRpc.mockResolvedValueOnce([
      {key: 'state', value: 1},
      {
        key: 'fact',
        value: factHex({...reviewFact, status: 'archive', result: 0}),
      },
      {key: 'result', value: 1},
    ])
    const voting = await getAdVoting(nextContract())
    expect(voting.status).toBe(VotingStatus.Open)
    expect(voting.result).toBe(1)
    expect(isApprovedVoting(voting)).toBe(false)
  })

  it('reads an ad voting saved by an older version whose options are not a list', async () => {
    const address = nextContract()
    saved.set(address, {
      address,
      status: VotingStatus.Archived,
      title: adVotingDefaults.title,
      options: 'Approve',
      result: 0,
      isFetched: true,
    })
    const voting = await getAdVoting(address)
    expect(callRpc).not.toHaveBeenCalled()
    expect(isApprovedVoting(voting)).toBe(false)
    expect(isRejectedVoting(voting)).toBe(false)
  })
})
