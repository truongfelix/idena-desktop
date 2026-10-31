import fs from 'fs'
import path from 'path'
import {
  editorMove,
  replyFocusInThread,
  scrollToShowAbove,
  withCompose,
} from './editor-history'
import {PostTarget} from './contract'

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

describe('the editor under the thread it answers (B-169)', () => {
  const key = (id) => String(id)
  const draft = (target) => ({kind: 'reply', target})

  it('marks the post a reply answers, in the thread shown', () => {
    expect(
      replyFocusInThread(draft(PostTarget.onPost(7)), '7', true, key)
    ).toBe('7')
  })

  it('marks the reply or comment a comment answers', () => {
    expect(
      replyFocusInThread(draft(PostTarget.onReply(8)), '7', true, key)
    ).toBe('8')
    expect(
      replyFocusInThread(draft(PostTarget.onComment(8, 9)), '7', true, key)
    ).toBe('9')
  })

  it('keeps the page editor for a new post, no thread, or no draft', () => {
    expect(
      replyFocusInThread(draft(PostTarget.newPost()), '7', true, key)
    ).toBeNull()
    expect(
      replyFocusInThread(draft(PostTarget.onPost(7)), null, false, key)
    ).toBeNull()
    expect(
      replyFocusInThread(draft(PostTarget.onPost(7)), '7', false, key)
    ).toBeNull()
    expect(replyFocusInThread(null, '7', true, key)).toBeNull()
  })
})

describe('the answered item shown above the pinned editor (B-169)', () => {
  // A window whose scrolling area starts at 60 and whose editor starts at 360.
  const show = (top, bottom) => scrollToShowAbove({top, bottom}, 360, 60)

  it('scrolls down an item hidden under the editor', () => {
    expect(show(435, 470)).toBe(126)
  })

  it('scrolls up an item above the area', () => {
    expect(show(-200, -160)).toBe(-276)
  })

  it('leaves an item that already shows', () => {
    expect(show(200, 240)).toBe(0)
  })

  it('shows a tall item from its top', () => {
    expect(show(500, 900)).toBe(424)
  })
})
