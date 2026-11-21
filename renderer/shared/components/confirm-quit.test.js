import React from 'react'
import {renderToString} from 'react-dom/server'
import {
  MINING_CHECK_TIMEOUT_MS,
  isMiningNow,
  setQuitQuestionOpen,
  useQuitQuestionOpen,
} from './confirm-quit'

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
    await expect(
      isMiningNow(() => {
        throw new Error('no settings')
      })
    ).resolves.toBe(false)
  })

  it('asks when a slow node does not answer before the main process quits on its own', async () => {
    const answer = isMiningNow(() => new Promise(() => {}))
    jest.advanceTimersByTime(MINING_CHECK_TIMEOUT_MS)
    await expect(answer).resolves.toBe(true)
  })
})

describe('useQuitQuestionOpen', () => {
  function readsOpen() {
    let result
    function Probe() {
      result = useQuitQuestionOpen()
      return null
    }
    renderToString(<Probe />)
    return result
  }

  afterEach(() => setQuitQuestionOpen(false))

  it('says whether the quit question shows', () => {
    expect(readsOpen()).toBe(false)
    setQuitQuestionOpen(true)
    expect(readsOpen()).toBe(true)
    setQuitQuestionOpen(false)
    expect(readsOpen()).toBe(false)
  })
})
