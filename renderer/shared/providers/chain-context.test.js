import {chainReducer, syncFields} from './chain-context'

jest.mock('../utils/utils', () => ({callRpc: jest.fn()}))
jest.mock('./settings-context', () => ({useSettingsState: () => ({})}))

const answer = (sync) => ({
  type: 'FETCH_SYNC_SUCCEEDED',
  payload: syncFields(sync),
})

describe('the chain state', () => {
  it('leaves Compacting once the node stops sending the flag', () => {
    let state = chainReducer(
      {loading: true, offline: true},
      answer({
        syncing: true,
        compacting: true,
        message: 'Compacting database...',
      })
    )
    expect(state.compacting).toBe(true)
    // The node omits compacting when false (omitempty).
    state = chainReducer(state, answer({syncing: true, message: ''}))
    expect(state.compacting).toBe(false)
  })

  it('clears it when the node stops answering', () => {
    const state = chainReducer(
      chainReducer({}, answer({syncing: true, compacting: true})),
      {type: 'FETCH_SYNC_FAILED'}
    )
    expect(state.compacting).toBe(false)
    expect(state.offline).toBe(true)
  })
})
