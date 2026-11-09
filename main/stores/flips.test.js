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
      {id: 'one', type: 'Draft', images: ['first'], scenes: [{}, null]},
      {id: 'two', type: 'Draft', images: ['second']},
    ])

    flips.deleteDraft('one')

    expect(flips.getFlips()).toEqual([
      {id: 'one', type: 'Removed', images: null, scenes: null},
      {id: 'two', type: 'Draft', images: ['second']},
    ])
  })

  it('clears all drafts', () => {
    flips.addDraft({id: 'one'})

    flips.clear()

    expect(flips.getFlips()).toEqual([])
  })
})
