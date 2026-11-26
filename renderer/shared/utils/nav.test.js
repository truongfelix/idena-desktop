import {isNavItemActive} from './nav'

const LINKS = [
  '/home',
  '/wallets',
  '/history',
  '/flips/list',
  '/contacts',
  '/social',
  '/oracles/list',
  '/adn/list',
  '/settings/general',
]

/** The links the sidebar marks on the page at `pathname`. */
const marked = (pathname) =>
  LINKS.filter((href) => isNavItemActive(pathname, href))

describe('the sidebar link marked for a page (B-320)', () => {
  it('marks Settings on every Settings tab', () => {
    for (const tab of ['general', 'node', 'advanced', 'connect'])
      expect(marked(`/settings/${tab}`)).toEqual(['/settings/general'])
  })

  it('marks the link of a section on each of its pages', () => {
    expect(marked('/flips/new')).toEqual(['/flips/list'])
    expect(marked('/flips/edit')).toEqual(['/flips/list'])
    expect(marked('/oracles/view')).toEqual(['/oracles/list'])
    expect(marked('/adn/offers')).toEqual(['/adn/list'])
  })

  it('marks one link on the page each link opens', () => {
    for (const href of LINKS) expect(marked(href)).toEqual([href])
  })

  it('marks no link on a page of no section, nor on a section sharing a prefix', () => {
    expect(marked('/validation')).toEqual([])
    expect(marked('/validation/after')).toEqual([])
    expect(marked('/homepage')).toEqual([])
    expect(marked('/settingsx/node')).toEqual([])
  })
})
