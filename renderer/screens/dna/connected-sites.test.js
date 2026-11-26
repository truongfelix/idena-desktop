import {
  disconnectMessage,
  findSite,
  forgetSite,
  readConnectedSites,
  recordSignIn,
  signInSite,
  sameSite,
} from './connected-sites'

const alice = '0xAAAA000000000000000000000000000000000001'
const bob = '0xbbbb000000000000000000000000000000000002'

describe('Idena Connect (B-318)', () => {
  it('names the site by the origin that receives the signature', () => {
    expect(
      signInSite({
        authenticationEndpoint: 'https://app.example.com/auth/v1/authenticate',
        nonceEndpoint: 'https://app.example.com/auth/v1/start-session',
        callbackUrl: 'https://app.example.com/done',
      })
    ).toEqual({
      site: 'https://app.example.com',
      host: 'app.example.com',
      website: 'app.example.com',
      nonceHost: null,
      returnHost: null,
      disconnectEndpoint: null,
    })
  })

  it('names a nonce endpoint on another host, and a callback on another site', () => {
    expect(
      signInSite({
        authenticationEndpoint: 'https://b.example/auth',
        nonceEndpoint: 'https://a.example/nonce',
        callbackUrl: 'https://a.example/done',
      })
    ).toEqual({
      site: 'https://b.example',
      host: 'b.example',
      website: 'a.example',
      nonceHost: 'a.example',
      returnHost: 'a.example',
      disconnectEndpoint: null,
    })
    // A front end on www., its endpoints on api.: one site, no warning.
    expect(
      signInSite({
        authenticationEndpoint: 'https://api.example.com/auth',
        nonceEndpoint: 'https://api.example.com/start',
        callbackUrl: 'https://www.example.com/done',
      })
    ).toEqual({
      site: 'https://api.example.com',
      host: 'api.example.com',
      website: 'www.example.com',
      nonceHost: null,
      returnHost: null,
      disconnectEndpoint: null,
    })
    expect(
      signInSite({
        authenticationEndpoint: 'http://localhost:29780/auth',
        nonceEndpoint: 'http://localhost:29780/nonce',
        callbackUrl: 'dna://signin-done',
      }).website
    ).toBeNull()
  })

  it('names a callback on another site than the one that receives the signature', () => {
    const relay = signInSite({
      authenticationEndpoint: 'https://duelbelote.fr/auth/v1/authenticate',
      nonceEndpoint: 'https://duelbelote.fr/auth/v1/start-session',
      callbackUrl: 'https://evil.example/done',
    })
    expect(relay.host).toBe('duelbelote.fr')
    expect(relay.returnHost).toBe('evil.example')
    for (const callbackUrl of [
      'https://duelbelote.fr/done',
      'https://www.duelbelote.fr/done',
      'dna://signin-done',
    ])
      expect(
        signInSite({
          authenticationEndpoint: 'https://api.duelbelote.fr/auth',
          nonceEndpoint: 'https://api.duelbelote.fr/start',
          callbackUrl,
        }).returnHost
      ).toBeNull()
    // Another port of the same host is the same site; a look-alike ending is not.
    expect(
      signInSite({
        authenticationEndpoint: 'http://127.0.0.1:29780/auth',
        nonceEndpoint: 'http://127.0.0.1:29780/start',
        callbackUrl: 'http://127.0.0.1:3000/done',
      }).returnHost
    ).toBeNull()
    expect(
      signInSite({
        authenticationEndpoint: 'https://duelbelote.fr/auth',
        nonceEndpoint: 'https://duelbelote.fr/start',
        callbackUrl: 'https://duelbelote.fr.evil.example/done',
      }).returnHost
    ).toBe('duelbelote.fr.evil.example')
  })

  it('takes two hosts for one site only with a www. or api., a port or a subdomain between them', () => {
    expect(sameSite('www.duelbelote.fr', 'api.duelbelote.fr')).toBe(true)
    expect(sameSite('duelbelote.fr', 'play.duelbelote.fr')).toBe(true)
    expect(sameSite('127.0.0.1:29780', '127.0.0.1:3000')).toBe(true)
    expect(sameSite('DuelBelote.fr.', 'duelbelote.fr')).toBe(true)
    expect(sameSite('victim.vercel.app', 'evil.vercel.app')).toBe(false)
    expect(sameSite('victim.co.uk', 'evil.co.uk')).toBe(false)
    expect(sameSite('victim.com.', 'evil.com.')).toBe(false)
    expect(sameSite('example.com', 'evil-example.com')).toBe(false)
    expect(sameSite('127.0.0.1', 'localhost')).toBe(false)
  })

  it('keeps a disconnect endpoint only on the site that receives the signature', () => {
    const link = {
      authenticationEndpoint: 'https://a.example/auth',
      nonceEndpoint: 'https://a.example/nonce',
      callbackUrl: 'https://a.example/done',
    }
    expect(
      signInSite({...link, disconnectEndpoint: 'https://a.example/bye'})
        .disconnectEndpoint
    ).toBe('https://a.example/bye')
    expect(
      signInSite({...link, disconnectEndpoint: 'https://b.example/bye'})
        .disconnectEndpoint
    ).toBeNull()
    expect(signInSite(link).disconnectEndpoint).toBeNull()
    expect(disconnectMessage('https://a.example', 1700000000)).toBe(
      'disconnect-https://a.example-1700000000'
    )
  })

  it('records the disconnect endpoint, and reads back only one on the site', () => {
    const site = 'https://a.example'
    const saved = recordSignIn(
      [],
      {site, address: alice, disconnectEndpoint: `${site}/bye`},
      5
    )
    expect(saved[0].disconnectEndpoint).toBe(`${site}/bye`)
    expect(readConnectedSites({sites: saved})).toEqual(saved)
    // An endpoint off the site is dropped, the entry and its history kept.
    expect(
      readConnectedSites({
        sites: [{...saved[0], disconnectEndpoint: 'https://b.example/bye'}],
      })
    ).toEqual([{...saved[0], disconnectEndpoint: null}])
  })

  it('has no site for an endpoint that is no web address', () => {
    expect(
      signInSite({authenticationEndpoint: 'file:///etc/passwd'}).site
    ).toBeNull()
  })

  it('records a first sign-in, then counts the next ones, the latest first', () => {
    const site = 'https://app.example.com'
    const first = recordSignIn(
      [],
      {site, address: alice, website: 'www.example.com'},
      1000
    )
    expect(first).toEqual([
      {
        site,
        address: alice.toLowerCase(),
        website: 'www.example.com',
        disconnectEndpoint: null,
        firstAt: 1000,
        lastAt: 1000,
        count: 1,
      },
    ])
    const other = recordSignIn(
      first,
      {site: 'https://b.example', address: bob},
      2000
    )
    const again = recordSignIn(other, {site, address: alice}, 3000)
    expect(again.map((e) => [e.site, e.count, e.firstAt, e.lastAt])).toEqual([
      [site, 2, 1000, 3000],
      ['https://b.example', 1, 2000, 2000],
    ])
    expect(findSite(again, site, alice.toLowerCase())).toBe(again[0])
    // One entry per site and account.
    expect(findSite(again, site, bob)).toBeNull()
  })

  it('forgets one site for one account only', () => {
    const site = 'https://app.example.com'
    const sites = recordSignIn(
      recordSignIn([], {site, address: alice}, 1),
      {site, address: bob},
      2
    )
    expect(forgetSite(sites, site, alice).map((e) => e.address)).toEqual([bob])
  })

  it('reads what it saved and leaves out what it cannot read', () => {
    const saved = recordSignIn(
      [],
      {site: 'https://a.example', address: alice},
      5
    )
    expect(readConnectedSites({sites: saved})).toEqual(saved)
    expect(readConnectedSites(null)).toEqual([])
    expect(readConnectedSites({sites: 'x'})).toEqual([])
    expect(
      readConnectedSites({
        sites: [
          ...saved,
          {
            site: 'ftp://files.example',
            address: bob,
            firstAt: 1,
            lastAt: 1,
            count: 1,
          },
          null,
        ],
      })
    ).toEqual(saved)
  })
})
