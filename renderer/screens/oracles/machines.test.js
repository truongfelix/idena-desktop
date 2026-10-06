import {interpret} from 'xstate'
import {callRpc} from '../../shared/utils/utils'
import {fetchNetworkSize} from '../../shared/api/dna'
import {createNewVotingMachine, votingListMachine} from './machines'
import {VotingStatus} from '../../shared/types'

jest.mock('../../shared/utils/utils', () => ({
  ...jest.requireActual('../../shared/utils/utils'),
  callRpc: jest.fn(),
}))
jest.mock('../../shared/api/dna', () => ({fetchNetworkSize: jest.fn()}))
jest.mock('../../shared/utils/db', () => {
  const store = {
    get: jest.fn(() =>
      Promise.reject(Object.assign(new Error(), {notFound: true}))
    ),
    put: jest.fn(() => Promise.resolve()),
  }
  return {
    requestDb: jest.fn(() => ({})),
    subDb: jest.fn(() => store),
    epochDb: jest.fn(() => ({
      put: jest.fn(() => Promise.resolve()),
      load: jest.fn(() => Promise.resolve({})),
      batchPut: jest.fn(() => Promise.resolve()),
    })),
  }
})

const {HASH_IN_MEMPOOL} = jest.requireActual('../../shared/utils/utils')

// Lets the promises behind the machine's services settle between timer steps.
async function settle() {
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

// Moves the clock 1 s at a time: a poll schedules the next one only once its answer is in.
async function advance(ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    jest.advanceTimersByTime(1000)
    // eslint-disable-next-line no-await-in-loop
    await settle()
  }
}

// callRpc answers by method; a function answer is called with the params.
function answer(byMethod) {
  callRpc.mockImplementation((method, ...params) => {
    const value = byMethod[method]
    return typeof value === 'function'
      ? value(...params)
      : Promise.resolve(value)
  })
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  jest.clearAllMocks()
})

describe('voting list', () => {
  function startList() {
    const onError = jest.fn()
    const service = interpret(
      votingListMachine
        .withContext({...votingListMachine.context, epoch: 1, address: '0x1'})
        .withConfig({
          actions: {onError, onResetLastVotingTimestamp: jest.fn()},
        }),
      {logger: () => {}}
    ).start()
    return {service, onError}
  }

  it('shows an error when the node does not answer, then loads on Try again', async () => {
    let answering = false
    answer({
      contract_oracleVotings: () =>
        answering ? Promise.resolve({}) : new Promise(() => {}),
    })
    const {service} = startList()
    await settle()
    await advance(1000)
    expect(service.state.matches('loading.late')).toBe(true)
    await advance(29 * 1000)
    expect(service.state.matches('failure.waiting')).toBe(true)
    expect(service.state.context.errorMessage).toBe(
      'The node did not answer in time'
    )

    answering = true
    service.send('RETRY')
    await settle()
    expect(service.state.matches('loaded')).toBe(true)
    service.stop()
  })

  it('asks again by itself after a failure', async () => {
    let failing = true
    answer({
      contract_oracleVotings: () =>
        failing
          ? Promise.reject(new Error('Failed to fetch'))
          : Promise.resolve({}),
    })
    const {service} = startList()
    await settle()
    expect(service.state.matches('failure.waiting')).toBe(true)
    expect(service.state.context.errorMessage).toBe('Failed to fetch')

    await advance(15 * 1000)
    expect(service.state.matches('failure.waiting')).toBe(true)

    failing = false
    await advance(15 * 1000)
    expect(service.state.matches('loaded')).toBe(true)
    service.stop()
  })
})

describe('new voting', () => {
  // Starts the form, or the review drawer and its Confirm when `confirm` is set (a state's invoke only starts on a
  // transition into it).
  function startNewVoting({confirm = false} = {}) {
    const onError = jest.fn()
    const onDone = jest.fn()
    const service = interpret(
      createNewVotingMachine(1, '0x1').withConfig({
        actions: {onError, onDone, onInvalidForm: jest.fn()},
        services: {
          estimateDeployContract: () => Promise.resolve({}),
          deployContract: () =>
            Promise.resolve({
              txHash: '0xdeploy',
              voting: {contractHash: '0xcontract'},
              from: '0x1',
              balance: 10,
            }),
        },
      }),
      {logger: () => {}}
    ).start(confirm ? {publishing: 'review'} : undefined)
    if (confirm) service.send('CONFIRM', {from: '0x1', balance: 10, stake: 1})
    return {service, onError, onDone}
  }

  it('shows an error instead of the form when the node fails, then the form on Try again', async () => {
    callRpc.mockRejectedValue(new Error('Failed to fetch'))
    fetchNetworkSize.mockResolvedValue(100)
    const {service} = startNewVoting()
    await settle()
    expect(service.state.matches('preloadFailed.waiting')).toBe(true)
    expect(service.state.context.preloadError).toBe('Failed to fetch')

    callRpc.mockResolvedValue(1)
    service.send('RETRY')
    await settle()
    expect(service.state.matches('choosingPreset')).toBe(true)
    expect(service.state.context.ownerDeposit).toBeGreaterThan(0)
    service.stop()
  })

  it('goes back to the form when the node drops the publishing transaction', async () => {
    answer({bcn_transaction: null})
    const {service, onError} = startNewVoting({confirm: true})
    await settle()
    expect(service.state.matches('publishing.deploy.deploying.mining')).toBe(
      true
    )
    await advance(20 * 1000)
    expect(onError).not.toHaveBeenCalled()
    await advance(10 * 1000)
    expect(service.state.matches('editing')).toBe(true)
    expect(onError.mock.calls[0][1].data.message).toMatch(
      'The voting is not published'
    )
    service.stop()
  })

  it('keeps a published voting pending when the node drops its start', async () => {
    answer({
      contract_estimateCall: {gasCost: '1', txFee: '1'},
      contract_call: '0xstart',
      bcn_transaction: (hash) =>
        Promise.resolve(hash === '0xdeploy' ? {blockHash: '0xblock'} : null),
    })
    const {service, onError, onDone} = startNewVoting({confirm: true})
    await settle()
    // The deploy is mined at the first poll; the start transaction is then unknown 3 times.
    await advance(10 * 1000)
    expect(service.state.matches(`publishing.${VotingStatus.Starting}`)).toBe(
      true
    )
    await advance(30 * 1000)
    expect(service.state.matches('done')).toBe(true)
    expect(service.state.context.status).toBe(VotingStatus.Pending)
    expect(onError.mock.calls[0][1].data.message).toMatch('not started')
    expect(onDone).toHaveBeenCalled()
    service.stop()
  })

  it('waits for the transaction while the node is unreachable', async () => {
    let reachable = false
    answer({
      bcn_transaction: () =>
        reachable
          ? Promise.resolve({blockHash: HASH_IN_MEMPOOL})
          : Promise.reject(new Error('Failed to fetch')),
    })
    const {service, onError} = startNewVoting({confirm: true})
    await settle()
    await advance(60 * 1000)
    reachable = true
    await advance(30 * 1000)
    expect(service.state.matches('publishing.deploy.deploying.mining')).toBe(
      true
    )
    expect(onError).not.toHaveBeenCalled()
    service.stop()
  })
})
