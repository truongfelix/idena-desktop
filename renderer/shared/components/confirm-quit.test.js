import {MINING_CHECK_TIMEOUT_MS, isMiningNow} from './confirm-quit'

jest.mock('../utils/utils', () => ({callRpc: jest.fn()}))
jest.mock('../providers/chain-context', () => ({useChainState: jest.fn()}))
jest.mock('../providers/settings-context', () => ({
  useSettingsState: jest.fn(),
}))
jest.mock('../hooks/use-toast', () => ({useFailToast: jest.fn()}))

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('isMiningNow', () => {
  it('reads the mining status from the node', async () => {
    await expect(
      isMiningNow(() => Promise.resolve({online: true}))
    ).resolves.toBe(true)
    await expect(
      isMiningNow(() => Promise.resolve({online: false}))
    ).resolves.toBe(false)
  })

  it('takes a node that fails as not mining', async () => {
    await expect(
      isMiningNow(() => Promise.reject(new Error('refused')))
    ).resolves.toBe(false)
  })

  it('stops waiting for a slow node before the main process quits on its own', async () => {
    const answer = isMiningNow(() => new Promise(() => {}))
    jest.advanceTimersByTime(MINING_CHECK_TIMEOUT_MS)
    await expect(answer).resolves.toBe(false)
  })
})
