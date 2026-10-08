import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IconLink} from './components'

describe('IconLink', () => {
  it('links to its page', () => {
    const html = renderToStaticMarkup(
      <IconLink href="/flips/new">New flip</IconLink>
    )
    expect(html).toMatch(/<a [^>]*href="\/flips\/new"[^>]*>New flip<\/a>/)
    expect(html).not.toContain('aria-disabled')
  })

  it('has no link while disabled, and looks disabled', () => {
    const html = renderToStaticMarkup(
      <IconLink href="/flips/new" isDisabled>
        New flip
      </IconLink>
    )
    expect(html).toContain('New flip')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('opacity:0.4')
    expect(html).toContain('cursor:not-allowed')
  })
})
