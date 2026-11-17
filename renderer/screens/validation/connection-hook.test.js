import React from 'react'
import {renderToString} from 'react-dom/server'
import {useChainState} from '../../shared/providers/chain-context'
import {STALE_HEAD_SECONDS} from '../../shared/utils/sync-steps'
import {useNodeConnection} from './connection'

jest.mock('../../shared/providers/chain-context', () => ({
  useChainState: jest.fn(),
}))
jest.mock('../../shared/utils/utils', () => ({
  HASH_IN_MEMPOOL:
    '0x0000000000000000000000000000000000000000000000000000000000000000',
  callRpc: jest.fn(),
}))

// What the hook returns on its first render, for the chain state as ChainProvider holds it (no isBehind field:
// only useSyncStep computes that one).
function connectionFor(chainState) {
  useChainState.mockReturnValue(chainState)
  let result
  function Probe() {
    result = useNodeConnection()
    return null
  }
  renderToString(<Probe />)
  return result
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

describe('useNodeConnection', () => {
  it('says lost for a node that calls itself synced on an old head', () => {
    expect(
      connectionFor({
        offline: false,
        syncing: false,
        headTime: nowSeconds() - STALE_HEAD_SECONDS - 60,
      })
    ).toEqual({offline: false, lost: true})
  })

  it('leaves a recent head, a node catching up and an offline node alone', () => {
    expect(
      connectionFor({offline: false, syncing: false, headTime: nowSeconds()})
    ).toEqual({offline: false, lost: false})
    expect(
      connectionFor({
        offline: false,
        syncing: true,
        headTime: nowSeconds() - STALE_HEAD_SECONDS - 60,
      })
    ).toEqual({offline: false, lost: false})
    expect(
      connectionFor({
        offline: true,
        syncing: false,
        headTime: nowSeconds() - STALE_HEAD_SECONDS - 60,
      })
    ).toEqual({offline: true, lost: false})
  })
})
