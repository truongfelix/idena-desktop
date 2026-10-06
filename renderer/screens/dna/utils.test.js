import apiClient from '../../shared/api/api-client'
import {
  dnaCallbackSite,
  dnaLinkMethod,
  dnaLinkParams,
  isOpenableDnaUrl,
  isValidDnaUrl,
  newerDnaLink,
  signNonce,
  urlLogContext,
} from './utils'

const doubleHashVector = require('./testdata/idena_dna_sign_double_hash.json')

jest.mock('../../shared/api/api-client', () => ({
  __esModule: true,
  default: jest.fn(),
}))

describe('Idena signing', () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it('requests the explicit doubleHash compatibility format', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {result: doubleHashVector.signature_hex},
    })
    apiClient.mockReturnValue({post})

    await expect(
      signNonce(doubleHashVector.value, doubleHashVector.format)
    ).resolves.toBe(doubleHashVector.signature_hex)
    expect(post).toHaveBeenCalledWith('/', {
      method: 'dna_sign',
      params: [doubleHashVector.value, 'doubleHash'],
      id: 1,
    })
  })

  it('preserves the node default when no signing format is supplied', async () => {
    const post = jest.fn().mockResolvedValue({data: {result: 'signature'}})
    apiClient.mockReturnValue({post})

    await expect(signNonce('challenge')).resolves.toBe('signature')
    expect(post).toHaveBeenCalledWith('/', {
      method: 'dna_sign',
      params: ['challenge'],
      id: 1,
    })
  })
})

describe('dna URL logging', () => {
  it('summarizes URL metadata without query values', () => {
    const context = urlLogContext(
      'https://idena.io/callback?token=secret-token&signature=secret-signature'
    )
    const logged = JSON.stringify(context)

    expect(context).toEqual({
      protocol: 'https:',
      host: 'idena.io',
      pathname: '/callback',
      searchParamKeys: ['signature', 'token'],
    })
    expect(logged).not.toContain('secret-token')
    expect(logged).not.toContain('secret-signature')
  })

  it('accepts URL objects', () => {
    expect(urlLogContext(new URL('dna://signin/v1?token=value'))).toEqual({
      protocol: 'dna:',
      host: 'signin',
      pathname: '/v1',
      searchParamKeys: ['token'],
    })
  })

  it('summarizes invalid URLs without raw content', () => {
    expect(urlLogContext('bad url with secret material')).toEqual({
      type: 'invalid',
      length: 28,
    })
  })
})

describe('dna link method', () => {
  it.each(['signin', 'send', 'raw', 'vote', 'invite', 'sign'])(
    'reads %s from the link host',
    (method) => {
      const url = `dna://${method}/v1?address=0x1&callback_url=https%3A%2F%2Fexample.org`
      expect(isValidDnaUrl(url)).toBe(true)
      expect(dnaLinkMethod(url)).toBe(method)
    }
  )

  it('reads the method from the path when the host is empty', () => {
    expect(dnaLinkMethod('dna:////send/v1?address=0x1')).toBe('send')
  })
})

describe('openable dna links', () => {
  const signIn = (params) =>
    `dna://signin/v1?${new URLSearchParams({
      token: 'abc',
      callback_url: 'https://example.org/done',
      nonce_endpoint: 'https://example.org/nonce',
      authentication_endpoint: 'https://example.org/auth',
      ...params,
    })}`

  it.each(['send', 'raw', 'vote', 'invite', 'sign'])(
    'opens a %s link',
    (method) => {
      expect(isOpenableDnaUrl(`dna://${method}/v1?address=0x1`)).toBe(true)
    }
  )

  it('opens a sign-in link with its token, callback and endpoints', () => {
    expect(isOpenableDnaUrl(signIn())).toBe(true)
    expect(isOpenableDnaUrl(signIn({callback_url: 'dna://send/v1'}))).toBe(true)
  })

  it.each([
    ['no callback', {callback_url: ''}],
    ['a callback that is not a URL', {callback_url: 'example.org'}],
    ['no token', {token: ''}],
    ['no nonce endpoint', {nonce_endpoint: ''}],
    [
      'an authentication endpoint that is not http',
      {authentication_endpoint: 'file:///auth'},
    ],
  ])('does not open a sign-in link with %s', (_, params) => {
    expect(isOpenableDnaUrl(signIn(params))).toBe(false)
  })

  it.each([
    ['an unknown method', 'dna://pay/v1?address=0x1'],
    ['no protocol version', 'dna://send?address=0x1'],
    ['a query value that does not decode', 'dna://sign/v1?message=100%25'],
    ['no link', undefined],
  ])('does not open a link with %s', (_, url) => {
    expect(isOpenableDnaUrl(url)).toBe(false)
  })

  it('splits the callback from the method parameters', () => {
    expect(
      dnaLinkParams(
        'dna://send/v1?address=0x1&amount=2&callback_url=https%3A%2F%2Fexample.org&callback_format=html'
      )
    ).toEqual({
      address: '0x1',
      amount: '2',
      callbackUrl: 'https://example.org',
      callbackFormat: 'html',
    })
  })
})

describe('newer dna link', () => {
  const first = {id: 1, url: 'dna://send/v1?address=0x1'}
  const second = {id: 2, url: 'dna://vote/v1?address=0x2'}

  it('takes a link when none waits', () => {
    expect(newerDnaLink(null, first)).toBe(first)
  })

  it('keeps the waiting link when nothing new came', () => {
    expect(newerDnaLink(first, null)).toBe(first)
    expect(newerDnaLink(null, undefined)).toBeNull()
  })

  it('keeps the newer of two links in either order', () => {
    expect(newerDnaLink(first, second)).toBe(second)
    expect(newerDnaLink(second, first)).toBe(second)
  })

  it('keeps the waiting copy of the same link', () => {
    expect(newerDnaLink(first, {...first})).toBe(first)
  })
})

describe('dna callback site', () => {
  it('names the host of a website callback and takes its favicon.ico', () => {
    expect(dnaCallbackSite('https://example.org/app/done?x=1')).toEqual({
      host: 'example.org',
      favicon: 'https://example.org/favicon.ico',
    })
  })

  it('prefers the favicon the link names', () => {
    expect(
      dnaCallbackSite(
        'https://example.org/done',
        'https://cdn.example.org/i.png'
      ).favicon
    ).toBe('https://cdn.example.org/i.png')
  })

  it('takes no favicon from a dna: callback', () => {
    expect(dnaCallbackSite('dna://send/v1?address=0x1')).toEqual({
      host: 'send',
      favicon: undefined,
    })
  })

  it('names a callback that is not a URL as it is', () => {
    expect(dnaCallbackSite('example.org')).toEqual({
      host: 'example.org',
      favicon: undefined,
    })
    expect(dnaCallbackSite(undefined)).toEqual({
      host: undefined,
      favicon: undefined,
    })
  })
})
