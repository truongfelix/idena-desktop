import {damagedStoreWhat, newDamagedStores} from './damaged-stores'

const t = (text) => `t:${text}`

describe('damaged saved files told to the user', () => {
  it('names what each file held', () => {
    expect(damagedStoreWhat('flips.json', t)).toBe('t:your flip drafts')
    expect(damagedStoreWhat('invites.json', t)).toBe('t:your invitations')
    expect(damagedStoreWhat('settings.json', t)).toBe('t:the settings')
    expect(damagedStoreWhat('flipFilter.json', t)).toBeNull()
  })

  it('tells each one once, as the list grows', () => {
    const one = [{file: 'flips.json', aside: 'flips.json.broken-1'}]
    const two = [
      ...one,
      {file: 'settings.json', aside: 'settings.json.broken-1'},
    ]
    expect(newDamagedStores(one, 0)).toEqual(one)
    expect(newDamagedStores(two, 1)).toEqual([two[1]])
    expect(newDamagedStores(two, 2)).toEqual([])
    expect(newDamagedStores(undefined, 0)).toEqual([])
  })
})
