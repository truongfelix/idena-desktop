import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {bannerItems, DEV_NOTE, DevNoteBannerContent, PACKAGE} from './dev-note'

describe('the banner items', () => {
  it('are the ads, then the developer note', () => {
    const ads = [{cid: 'a'}, {cid: 'b'}]
    expect(bannerItems(ads)).toEqual([...ads, DEV_NOTE])
  })

  it('are the developer note alone with no ads', () => {
    expect(bannerItems([])).toEqual([DEV_NOTE])
    expect(bannerItems(undefined)).toEqual([DEV_NOTE])
  })
})

describe('the developer note in the banner', () => {
  it('reads as the phone app line', () => {
    const html = renderToStaticMarkup(
      <DevNoteBannerContent onOpen={() => {}} />
    )
    expect(html).toContain('A note from the dev')
    expect(html).toContain('Community work, same chain as the original.')
  })
})

describe('the package the developer note lists', () => {
  it('names every repository, the profiles contract included', () => {
    expect(PACKAGE).toEqual([
      'truongfelix/idena-go',
      'truongfelix/idena-desktop',
      'truongfelix/idena-mobile',
      'truongfelix/idena-profile',
    ])
  })
})
