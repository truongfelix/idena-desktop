jest.mock('../../shared/utils/dexieDb', () => {
  const stored = new Map()
  return {
    rows: stored,
    dexieDb: {
      table: () => ({
        get: (id) => Promise.resolve(stored.get(id)),
        add: (row) => {
          stored.set(row.id, row)
          return Promise.resolve(row.id)
        },
      }),
    },
  }
})

const {rows} = require('../../shared/utils/dexieDb')
const {copyAdAsDraft} = require('./drafts')
const {AdStatus} = require('./types')

const thumb = new Uint8Array([1, 2])
const media = new Uint8Array([3, 4])

// A rejected ad as the app stores it: its review's content and voting, the status it was given then.
const rejected = {
  id: 'ad-1',
  title: 'My ad',
  desc: 'Its text',
  url: 'https://example.com',
  language: 'en',
  age: 2,
  os: 'linux',
  stake: 100,
  thumb,
  media,
  author: '0xauthor',
  status: AdStatus.Reviewing,
  cid: 'bafyreviewed',
  contract: '0xvoting',
}

afterEach(() => rows.clear())

describe('edit a rejected ad as a new draft', () => {
  it('stores a draft with its texts, audience and pictures', async () => {
    rows.set(rejected.id, rejected)
    const id = await copyAdAsDraft('ad-1', '0xauthor', 'ad-2')
    expect(id).toBe('ad-2')
    expect(rows.get('ad-2')).toEqual({
      id: 'ad-2',
      title: 'My ad',
      desc: 'Its text',
      url: 'https://example.com',
      language: 'en',
      age: 2,
      os: 'linux',
      stake: 100,
      thumb,
      media,
      author: '0xauthor',
      status: AdStatus.Draft,
    })
  })

  it('leaves the rejected ad as it was', async () => {
    rows.set(rejected.id, rejected)
    await copyAdAsDraft('ad-1', '0xauthor', 'ad-2')
    expect(rows.get('ad-1')).toBe(rejected)
  })

  it('says when the ad is not stored', async () => {
    await expect(copyAdAsDraft('ad-9', '0xauthor')).rejects.toThrow(
      'no stored ad ad-9'
    )
  })
})
