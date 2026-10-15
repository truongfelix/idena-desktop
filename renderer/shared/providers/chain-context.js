import React, {useEffect} from 'react'
import {useInterval} from '../hooks/use-interval'
import {useSettingsState} from './settings-context'
import {callRpc} from '../utils/utils'
import {
  SyncPhase,
  addRateSample,
  headIsStale,
  syncStep,
} from '../utils/sync-steps'

const FETCH_SYNC_SUCCEEDED = 'FETCH_SYNC_SUCCEEDED'
const FETCH_SYNC_FAILED = 'FETCH_SYNC_FAILED'
const SET_LOADING = 'SET_LOADING'

const initialState = {
  loading: true,
  offline: true,
  syncing: false,
  currentBlock: null,
  highestBlock: null,
  progress: null,
  // The chain's head block (bcn_lastBlock): its height and when it was made (seconds); while a fast sync holds
  // headers above the chain, bcn_syncing's currentBlock is the headers' height, not this.
  chainBlock: null,
  headTime: null,
  // While syncing: the chain's and the headers' speeds in blocks per second, null until measured.
  blocksPerSecond: null,
  headersPerSecond: null,
}

function chainReducer(state, action) {
  switch (action.type) {
    case SET_LOADING: {
      return {
        ...state,
        loading: true,
      }
    }
    case FETCH_SYNC_SUCCEEDED: {
      return {
        ...state,
        ...action.payload,
        offline: false,
        loading: false,
      }
    }
    case FETCH_SYNC_FAILED:
      return {
        ...state,
        syncing: false,
        offline: true,
        loading: false,
      }
    default:
      throw new Error(`Unknown action ${action.type}`)
  }
}

const ChainStateContext = React.createContext()

// eslint-disable-next-line react/prop-types
function ChainProvider({children}) {
  const {useExternalNode} = useSettingsState()
  const [state, dispatch] = React.useReducer(chainReducer, initialState)
  const chainSamples = React.useRef([])
  const headerSamples = React.useRef([])

  useEffect(() => {
    dispatch({type: SET_LOADING})
  }, [useExternalNode])

  useInterval(
    async () => {
      try {
        const sync = await callRpc('bcn_syncing')
        const head = await callRpc('bcn_lastBlock').catch(() => null)
        const chainBlock = (head && head.height) || null
        const headTime = (head && head.timestamp) || null
        let blocksPerSecond = null
        let headersPerSecond = null
        if (sync.syncing) {
          const now = Date.now()
          const chain = addRateSample(
            chainSamples.current,
            chainBlock || sync.currentBlock,
            now
          )
          const headers = addRateSample(
            headerSamples.current,
            sync.currentBlock,
            now
          )
          chainSamples.current = chain.samples
          headerSamples.current = headers.samples
          blocksPerSecond = chain.rate
          headersPerSecond = headers.rate
        } else {
          chainSamples.current = []
          headerSamples.current = []
        }
        dispatch({
          type: FETCH_SYNC_SUCCEEDED,
          payload: {
            ...sync,
            chainBlock,
            headTime,
            blocksPerSecond,
            headersPerSecond,
          },
        })
      } catch (error) {
        dispatch({type: FETCH_SYNC_FAILED})
      }
    },
    !state.offline && state.syncing ? 1000 * 1 : 1000 * 5,
    true
  )

  return (
    <ChainStateContext.Provider value={state}>
      {children}
    </ChainStateContext.Provider>
  )
}

function useChainState() {
  const context = React.useContext(ChainStateContext)
  if (context === undefined) {
    throw new Error('useChainState must be used within a ChainProvider')
  }
  return context
}

// The sync's step ({phase, done, total}) and its speed in blocks per second (null until measured, and while
// waiting for the snapshot), and whether a node that says it is synced has an old head block (`isBehind`).
function useSyncStep() {
  const {
    syncing,
    chainBlock,
    currentBlock,
    highestBlock,
    headTime,
    blocksPerSecond,
    headersPerSecond,
  } = useChainState()
  const step = syncStep({
    chain: chainBlock,
    headers: currentBlock,
    highest: highestBlock,
    chainMoving: (blocksPerSecond || 0) > 0,
  })
  let speed = null
  if (step.phase === SyncPhase.Headers) speed = headersPerSecond
  else if (step.phase === SyncPhase.Blocks) speed = blocksPerSecond
  return {
    step,
    speed: speed > 0 ? speed : null,
    isBehind: !syncing && headIsStale(headTime, Date.now() / 1000),
  }
}

export {ChainProvider, useChainState, useSyncStep}
