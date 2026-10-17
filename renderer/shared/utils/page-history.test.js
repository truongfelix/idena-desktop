import fs from 'fs'
import path from 'path'
import {closeMove, historyIndexOf, numberHistory} from './page-history'

/** A window.history with its entries, as the browser keeps them. */
function fakeHistory() {
  const entries = [{state: {__N: true, url: '/home'}, url: '/home'}]
  let at = 0
  const history = {
    get state() {
      return entries[at].state
    },
    pushState(state, _title, url) {
      entries.splice(at + 1)
      entries.push({state, url})
      at += 1
    },
    replaceState(state, _title, url) {
      entries[at] = {state, url: url ?? entries[at].url}
    },
    back() {
      at -= 1
    },
  }
  return history
}

describe('the numbered history', () => {
  it('numbers each push from the page it was made from, keeping the state', () => {
    const history = fakeHistory()
    numberHistory(history)
    expect(historyIndexOf(history.state)).toBe(0)
    expect(history.state.__N).toBe(true)
    history.pushState({__N: true, url: '/oracles/list'}, '', '/oracles/list')
    history.pushState({__N: true, url: '/oracles/view'}, '', '/oracles/view')
    expect(historyIndexOf(history.state)).toBe(2)
    expect(history.state.url).toBe('/oracles/view')
    history.replaceState(
      {__N: true, url: '/oracles/view?x'},
      '',
      '/oracles/view?x'
    )
    expect(historyIndexOf(history.state)).toBe(2)
    history.back()
    expect(historyIndexOf(history.state)).toBe(1)
    history.pushState({__N: true}, '', '/flips/list')
    expect(historyIndexOf(history.state)).toBe(2)
  })

  it('numbers a history once', () => {
    const history = fakeHistory()
    numberHistory(history)
    numberHistory(history)
    history.pushState({}, '', '/a')
    expect(historyIndexOf(history.state)).toBe(1)
  })

  it('closes a page by going back only with a page of the app behind it', () => {
    expect(closeMove({idenaIndex: 3})).toBe('back')
    expect(closeMove({idenaIndex: 0})).toBe('replace')
    expect(closeMove(null)).toBe('replace')
    expect(closeMove({__N: true})).toBe('replace')
  })
})

describe('the close buttons', () => {
  // A close button that pushes a page adds it after the closed one: the way back reopened what was closed (B-108).
  // A link that replaces the closed page is fine.
  it('close with useClosePage, never by pushing a page', () => {
    const root = path.join(__dirname, '..', '..')
    const files = (dir) =>
      fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory())
          return ['.next', 'out', 'node_modules'].includes(entry.name)
            ? []
            : files(file)
        return entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')
          ? [file]
          : []
      })
    const pushing = files(root).filter((file) => {
      const source = fs.readFileSync(file, 'utf8')
      return (
        /<CloseButton[^>]*onClick=\{\(\) => (router\.push|redirect)\(/.test(
          source
        ) || /<NextLink(?![^>]*\breplace\b)[^>]*>\s*<CloseButton/.test(source)
      )
    })
    expect(pushing.map((file) => path.relative(root, file))).toEqual([])
  })
})
