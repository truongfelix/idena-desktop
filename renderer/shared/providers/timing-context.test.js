import {nodeReportsWrongTime} from './timing-context'

describe('clock check', () => {
  it('follows the node when it answers', () => {
    expect(nodeReportsWrongTime({offline: false, wrongTime: true})).toBe(true)
    expect(nodeReportsWrongTime({offline: false, wrongTime: false})).toBe(false)
  })

  it('says nothing while the node does not answer or before its first answer', () => {
    expect(nodeReportsWrongTime({offline: true, wrongTime: true})).toBe(false)
    expect(nodeReportsWrongTime({offline: false})).toBe(false)
    expect(nodeReportsWrongTime({offline: true})).toBe(false)
  })
})
