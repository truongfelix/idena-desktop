import {showsBackToTop} from './back-to-top'

describe('the ↑ button', () => {
  it('shows once the page is scrolled down more than one screen', () => {
    expect(showsBackToTop({scrollTop: 0, clientHeight: 800})).toBe(false)
    expect(showsBackToTop({scrollTop: 800, clientHeight: 800})).toBe(false)
    expect(showsBackToTop({scrollTop: 801, clientHeight: 800})).toBe(true)
  })

  it('stays hidden for a page not drawn yet', () => {
    expect(showsBackToTop({scrollTop: 10, clientHeight: 0})).toBe(false)
  })
})
