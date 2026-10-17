import {theme} from '@chakra-ui/react'
import {answerAvatarSize} from './thread'

describe("a thread's pictures", () => {
  // A size outside the theme's scale is read as pixels: answers showed an 11 px picture (B-100).
  it('take steps of the size scale, an answer bigger than a comment', () => {
    for (const depth of [0, 1, 2]) {
      expect(Object.keys(theme.sizes)).toContain(
        String(answerAvatarSize(depth))
      )
    }
    expect(answerAvatarSize(0)).toBeGreaterThan(answerAvatarSize(1))
  })
})
