import fs from 'fs'
import path from 'path'

// i18next reads the text before the first ':' of a key as a namespace and shows only the rest ("The node in use
// cannot change it: it runs with 4 MiB" showed "it runs with 4 MiB"). The app's texts with a ':' pass their own
// nsSeparator ('!!' or '|') to t().

/** The whole `t(...)` call starting at `start` (the index of "t("), up to its matching parenthesis. */
function callAt(source, start) {
  let depth = 0
  let quote = null
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
    } else if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return source.slice(start)
}

function callsMissingSeparator() {
  const offenders = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['.next', 'out', 'node_modules'].includes(entry.name)) visit(file)
      } else if (
        entry.name.endsWith('.js') &&
        !entry.name.endsWith('.test.js')
      ) {
        const source = fs.readFileSync(file, 'utf8')
        for (const match of source.matchAll(
          /\bt\(\s*(?:(['"`])((?:(?!\1)[^\\]|\\.)*?)\1|risk\.message)/gu
        )) {
          const key = match[2] ?? 'risk.message'
          const isColonText =
            key === 'risk.message' ||
            (key.includes(':') && !key.includes('://'))
          if (
            isColonText &&
            !callAt(source, match.index).includes('nsSeparator')
          ) {
            offenders.push(`${path.basename(file)}: ${key.slice(0, 60)}`)
          }
        }
      }
    }
  }
  visit(path.join(__dirname, '..', '..'))
  return offenders
}

describe('translation keys with a colon', () => {
  it('pass their own namespace separator to t()', () => {
    expect(callsMissingSeparator()).toEqual([])
  })
})
