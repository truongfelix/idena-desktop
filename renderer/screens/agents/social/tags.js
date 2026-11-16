import {LIKE} from '../../social/contract'

// A post that tags an agent (B-264, owner 2026-11-16): Idena Social has no tag of its own, so a tag is "@" and the
// account's profile name in a post's text, anywhere on Social, as other apps show it. A name is 3 to 20 of a-z, 0-9
// and _ (social/profiles.js PROFILE_NAME): "@joke" is no tag of "@joker", nor is "x@joke" (an e-mail address).

const NAME = /^@?([a-z0-9_]{3,20})$/u

/** The name of `name` ("@name" or "name") to look for, lowercase, or null when it is no profile name. */
export function tagName(name) {
  const match = NAME.exec(
    String(name || '')
      .trim()
      .toLowerCase()
  )
  return match ? match[1] : null
}

/** Whether `message` tags the profile name `name` (tagName's). A text on IPFS is not read: no tag. */
export function tags(message, name) {
  if (!name || typeof message !== 'string' || message === LIKE) return false
  if (message.startsWith('ipfs://')) return false
  const text = message.toLowerCase()
  const tag = `@${name}`
  let at = text.indexOf(tag)
  while (at >= 0) {
    const before = at === 0 ? '' : text[at - 1]
    const after = text[at + tag.length] || ''
    if (!/[a-z0-9_@]/u.test(before) && !/[a-z0-9_]/u.test(after)) return true
    at = text.indexOf(tag, at + 1)
  }
  return false
}
