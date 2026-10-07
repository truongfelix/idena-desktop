import {TextEncoder, TextDecoder} from 'util'

jest.mock('../../shared/utils/utils', () => ({
  ...jest.requireActual('../../shared/utils/utils'),
  callRpc: jest.fn(),
}))
jest.mock('../../shared/utils/dexieDb', () => ({
  dexieDb: {
    table: () => ({
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
    }),
  },
}))

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

const {callRpc} = require('../../shared/utils/utils')
const {
  adReviewStatus,
  adVotingDefaults,
  fetchProfileAds,
  getAdVoting,
} = require('./utils')
const {AdStatus} = require('./types')

const factHex = (value) =>
  `0x${Buffer.from(JSON.stringify(value)).toString('hex')}`

const reviewFact = {
  title: adVotingDefaults.title,
  desc: 'An ad',
  options: adVotingDefaults.options,
  adCid: 'bafyad',
}

// The contract's data: `state` 0 = deployed, not started; 1 = started; 2 = finished.
function contractData(state, result = null) {
  callRpc.mockResolvedValueOnce([
    {key: 'state', value: state},
    {key: 'fact', value: factHex(reviewFact)},
    {
      key: 'result',
      ...(result === null ? {error: 'data is nil'} : {value: result}),
    },
  ])
}

// What the node answers for an address that holds no contract (a deployment that never got into a block).
function noContract() {
  callRpc.mockResolvedValueOnce([
    {key: 'state', error: 'data is nil'},
    {key: 'fact', error: 'data is nil'},
    {key: 'result', error: 'data is nil'},
  ])
}

let contract = 0
const nextContract = () => {
  contract += 1
  return `0xd${contract}`
}

const statusOf = async (savedStatus) =>
  adReviewStatus(savedStatus, await getAdVoting(nextContract()))

afterEach(() => jest.clearAllMocks())

describe('ad review status', () => {
  it('is a draft to start when the review voting was deployed but never started', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    contractData(0)
    expect(await statusOf(AdStatus.Reviewing)).toEqual({
      status: AdStatus.Draft,
      reviewNotStarted: true,
    })
  })

  it('is reviewing once the voting started', async () => {
    contractData(1)
    expect(await statusOf(AdStatus.Reviewing)).toEqual({
      status: AdStatus.Reviewing,
      reviewNotStarted: false,
    })
  })

  it('is approved or rejected when the voting finished', async () => {
    contractData(2, 0)
    expect((await statusOf(AdStatus.Reviewing)).status).toBe(AdStatus.Approved)
    contractData(2, 1)
    expect((await statusOf(AdStatus.Reviewing)).status).toBe(AdStatus.Rejected)
  })

  it('is rejected when the voting ended without a winner', async () => {
    // No result is stored then: the voting used to read as missing and the ad stayed "reviewing".
    contractData(2)
    expect(await statusOf(AdStatus.Reviewing)).toEqual({
      status: AdStatus.Rejected,
      reviewNotStarted: false,
    })
  })

  it('is a draft again when the review contract does not exist', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    noContract()
    expect(await statusOf(AdStatus.Reviewing)).toEqual({
      status: AdStatus.Draft,
      reviewNotStarted: false,
    })
  })

  it('keeps any other saved status without a voting', () => {
    expect(adReviewStatus(AdStatus.Published, undefined).status).toBe(
      AdStatus.Published
    )
  })
})

describe('fetchProfileAds', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))

  it('gives no ads for an identity without a profile', async () => {
    callRpc.mockResolvedValueOnce({profileHash: ''})
    await expect(fetchProfileAds('0xa')).resolves.toEqual([])
  })

  it('throws when the identity cannot be read', async () => {
    callRpc.mockRejectedValueOnce(new Error('connection refused'))
    await expect(fetchProfileAds('0xa')).rejects.toThrow(
      /Cannot read the campaigns already in your profile/
    )
  })

  it('throws when the profile cannot be read', async () => {
    // A publish then wrote a profile holding only the new ad.
    callRpc
      .mockResolvedValueOnce({profileHash: 'bafyprofile'})
      .mockRejectedValueOnce(new Error('context deadline exceeded'))
    await expect(fetchProfileAds('0xa')).rejects.toThrow(
      /Cannot read the campaigns already in your profile/
    )
  })
})
