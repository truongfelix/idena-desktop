import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {LayoutContainer} from './layout'

describe('the row of the sidebar and the page', () => {
  it('stays one row in a narrow window: it never wraps', () => {
    const html = renderToStaticMarkup(
      <LayoutContainer>
        <nav>sidebar</nav>
        <main>page</main>
      </LayoutContainer>
    )
    // The CSS Chakra writes for the row, so a wrap given any way (prop, style, theme) shows here.
    expect(html).toContain('display:flex')
    expect(html).toContain('align-items:stretch')
    expect(html).not.toMatch(/flex-wrap:\s*wrap/)
    expect(html).not.toMatch(/flex-flow:[^;"]*wrap/)
  })
})
