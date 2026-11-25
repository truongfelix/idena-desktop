import {
  findSite,
  forgetSite,
  readConnectedSites,
  recordSignIn,
  signInSite,
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
      otherHosts: [],
    })
  })

  it('names the other hosts a link shows, and no dna: callback', () => {
    expect(
      signInSite({
        authenticationEndpoint: 'https://evil.example/auth',
        nonceEndpoint: 'https://good.example/nonce',
        callbackUrl: 'https://good.example/done',
      })
    ).toEqual({
      site: 'https://evil.example',
      host: 'evil.example',
      otherHosts: ['good.example'],
    })
    expect(
      signInSite({
        authenticationEndpoint: 'http://localhost:29780/auth',
        nonceEndpoint: 'http://localhost:29780/nonce',
        callbackUrl: 'dna://signin-done',
      }).otherHosts
    ).toEqual([])
  })

  it('has no site for an endpoint that is no web address', () => {
    expect(
      signInSite({authenticationEndpoint: 'file:///etc/passwd'}).site
    ).toBeNull()
  })

  it('records a first sign-in, then counts the next ones, the latest first', () => {
    const site = 'https://app.example.com'
    const first = recordSignIn([], {site, address: alice}, 1000)
    expect(first).toEqual([
      {
        site,
        address: alice.toLowerCase(),
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
