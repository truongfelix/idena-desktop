import {historyMoveOf} from './history-keys'

const key = (k, mods = {}) => ({
  key: k,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
})

describe('the keys that move in the history', () => {
  it('are Alt+Left and Alt+Right on Windows and Linux', () => {
    expect(historyMoveOf(key('ArrowLeft', {altKey: true}), false)).toBe('back')
    expect(historyMoveOf(key('ArrowRight', {altKey: true}), false)).toBe(
      'forward'
    )
    expect(historyMoveOf(key('ArrowLeft'), false)).toBeNull()
    expect(
      historyMoveOf(key('ArrowLeft', {altKey: true, ctrlKey: true}), false)
    ).toBeNull()
    expect(historyMoveOf(key('[', {metaKey: true}), false)).toBeNull()
  })

  it('are Cmd+[ and Cmd+] on macOS', () => {
    expect(historyMoveOf(key('[', {metaKey: true}), true)).toBe('back')
    expect(historyMoveOf(key(']', {metaKey: true}), true)).toBe('forward')
    expect(historyMoveOf(key('ArrowLeft', {metaKey: true}), true)).toBe('back')
    expect(historyMoveOf(key('ArrowLeft', {altKey: true}), true)).toBeNull()
    expect(
      historyMoveOf(key('[', {metaKey: true, shiftKey: true}), true)
    ).toBeNull()
  })
})
