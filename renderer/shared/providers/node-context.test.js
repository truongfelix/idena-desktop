import {initialState, nodeReducer} from './node-context'

describe('the node state', () => {
  const converting = {percent: 31, minutesLeft: 42}

  it('holds the IPFS conversion the main process reads from the node log', () => {
    const state = nodeReducer(initialState, {
      type: 'IPFS_CONVERSION',
      data: converting,
    })
    expect(state.ipfsConversion).toEqual(converting)
    expect(
      nodeReducer(state, {type: 'IPFS_CONVERSION', data: null}).ipfsConversion
    ).toBeNull()
  })

  it('drops it when the node stops or fails', () => {
    const state = {...initialState, ipfsConversion: converting}
    expect(nodeReducer(state, {type: 'NODE_STOP'}).ipfsConversion).toBeNull()
    expect(nodeReducer(state, {type: 'NODE_FAILED'}).ipfsConversion).toBeNull()
  })
})
