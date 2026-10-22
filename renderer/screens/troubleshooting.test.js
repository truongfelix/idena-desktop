import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {NodeStopReason} from './troubleshooting'
import {initialState, nodeReducer} from '../shared/providers/node-context'

const RESET_NOTE = 'Reset node does not fix this'

describe('why the node stopped, on the troubleshooting screen', () => {
  it('says a known cause, that Reset does not fix it, and the node’s line', () => {
    const html = renderToStaticMarkup(
      <NodeStopReason
        reason={{
          cause: 'node-port-taken',
          line: 'cannot start IPFS node on port 40405, err: listen tcp :40405: bind: address already in use',
        }}
      />
    )
    expect(html).toContain('Why the node stopped')
    expect(html).toContain('Another program uses the node port')
    expect(html).toContain(RESET_NOTE)
    expect(html).toContain('cannot start IPFS node on port 40405')
  })

  it('gives an unknown reason as the node wrote it, without the Reset note', () => {
    const html = renderToStaticMarkup(
      <NodeStopReason
        reason={{cause: null, line: 'panic: runtime error: nil map'}}
      />
    )
    expect(html).toContain('panic: runtime error: nil map')
    expect(html).not.toContain(RESET_NOTE)
  })

  it('shows nothing without a reason', () => {
    expect(renderToStaticMarkup(<NodeStopReason reason={null} />)).toBe('')
    expect(
      renderToStaticMarkup(
        <NodeStopReason reason={{cause: null, line: null}} />
      )
    ).toBe('')
  })
})

describe('the reason in the node state', () => {
  const reason = {cause: 'data-folder-in-use', line: 'open chain database: x'}

  it('is kept from the failure, through a later failure without one', () => {
    let state = nodeReducer(initialState, {type: 'NODE_FAILED', data: reason})
    expect(state.stopReason).toEqual(reason)
    state = nodeReducer(state, {type: 'NODE_FAILED'})
    expect(state.stopReason).toEqual(reason)
  })

  it('is dropped when the node starts over or the troubleshooting runs', () => {
    const failed = nodeReducer(initialState, {
      type: 'NODE_FAILED',
      data: reason,
    })
    expect(nodeReducer(failed, {type: 'NODE_REINIT'}).stopReason).toBeNull()
    expect(
      nodeReducer(failed, {type: 'TROUBLESHOOTING_RESTART_NODE'}).stopReason
    ).toBeNull()
  })
})
