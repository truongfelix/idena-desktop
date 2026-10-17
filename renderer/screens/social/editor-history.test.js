import fs from 'fs'
import path from 'path'
import {editorMove, withCompose} from './editor-history'

const move = (hadDraft, hasDraft, hadCompose, hasCompose) =>
  editorMove({hadDraft, hasDraft, hadCompose, hasCompose})

describe('the editor in the history', () => {
  it('adds its step when a draft opens', () => {
    expect(move(false, true, false, false)).toBe('push')
    expect(withCompose({post: '2'})).toEqual({post: '2', compose: '1'})
  })

  it('closes as Cancel when the way back leaves its step', () => {
    expect(move(true, true, true, false)).toBe('cancel')
  })

  it('steps back when the draft closes (Cancel, sent)', () => {
    expect(move(true, false, true, true)).toBe('back')
  })

  it('steps back from its step reached without a draft (forward)', () => {
    expect(move(false, false, false, true)).toBe('back')
  })

  it('does nothing otherwise', () => {
    expect(move(true, true, true, true)).toBeNull()
    expect(move(false, false, false, false)).toBeNull()
    // The step is being added for the draft just opened.
    expect(move(true, true, false, false)).toBeNull()
    // Waiting for the step back already asked for.
    expect(move(false, false, true, true)).toBeNull()
  })
})

describe('the Social page', () => {
  // The editor showed whatever the address said: the way back left it open (B-107).
  it('ties the editor to its step in the history', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'social.js'),
      'utf8'
    )
    expect(source).toMatch(/editorMove\(/)
  })
})
