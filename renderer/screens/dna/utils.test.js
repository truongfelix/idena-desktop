import apiClient from '../../shared/api/api-client'
import {dnaLinkMethod, isValidDnaUrl, signNonce, urlLogContext} from './utils'

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
