const low = require('lowdb')
const Memory = require('lowdb/adapters/Memory')

const mockDatabase = low(new Memory())

jest.mock('./setup', () => ({
  prepareDb: jest.fn(() => mockDatabase),
}))

const flips = require('./flips')

describe('flip store', () => {
  beforeEach(() => {
    mockDatabase.setState({flips: []})
  })

  it('reads existing electron-store-compatible data', () => {
    mockDatabase.setState({flips: [{id: 'one', type: 'Draft'}]})

    expect(flips.getFlips()).toEqual([{id: 'one', type: 'Draft'}])
    expect(flips.getFlip('one')).toEqual({id: 'one', type: 'Draft'})
  })

  it('updates only the selected draft', () => {
    flips.saveFlips([
      {id: 'one', type: 'Draft', images: ['first']},
      {id: 'two', type: 'Draft', images: ['second']},
    ])

    flips.updateDraft({id: 'two', type: 'Published'})

    expect(flips.getFlips()).toEqual([
      {id: 'one', type: 'Draft', images: ['first']},
      {id: 'two', type: 'Published', images: ['second']},
    ])
  })

  it('marks only the selected draft as removed', () => {
    flips.saveFlips([
      {
        id: 'one',
        type: 'Draft',
        images: ['first'],
        scenes: [{}, null],
        // B-236: its story goes with it.
        story: {title: 'T', prompts: ['p']},
      },
      {id: 'two', type: 'Draft', images: ['second']},
    ])

    flips.deleteDraft('one')

    expect(flips.getFlips()).toEqual([
      {id: 'one', type: 'Removed', images: null, scenes: null, story: null},
      {id: 'two', type: 'Draft', images: ['second']},
    ])
  })

  it("keeps a draft's story when a save leaves it out (an older version, B-236)", () => {
    flips.saveFlips([{id: 'one', type: 'Draft', story: {title: 'T'}}])
    flips.updateDraft({id: 'one', type: 'Draft', images: ['a']})
    expect(flips.getFlip('one').story).toEqual({title: 'T'})
  })

  it('clears all drafts', () => {
    flips.addDraft({id: 'one'})

    flips.clear()

    expect(flips.getFlips()).toEqual([])
  })

  it("gives a flip's marks without its pictures", () => {
    flips.saveFlips([
      {
        id: 'one',
        type: 'Draft',
        createdAt: 'c',
        modifiedAt: 'm',
        images: ['big'],
        protectedImages: ['big'],
        agentFlip: {by: 'a', stage: 'story'},
      },
      {id: 'two', type: 'Published', createdAt: 'c'},
    ])
    expect(flips.getFlipStamp('one')).toEqual({
      type: 'Draft',
      modifiedAt: 'm',
      agentFlip: {by: 'a', stage: 'story'},
      agentVerdict: null,
    })
    expect(flips.getFlipStamp('two')).toEqual({
      type: 'Published',
      modifiedAt: 'c',
      agentFlip: null,
      agentVerdict: null,
    })
    expect(flips.getFlipStamp('none')).toBeNull()
  })
})
