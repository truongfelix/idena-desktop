import {adversarialSources, pickAdversarialSources} from './utils'

// The nonsense picture is a collage of four pictures: the web search's, or the story pictures when the
// search found fewer than four (search off, no results, no connection).
describe('pickAdversarialSources', () => {
  it('never picks an empty slot', () => {
    // 5 of 8 search slots set: an empty slot picked used to leave the picture waiting forever.
    const images = ['a', undefined, 'b', '', 'c', undefined, 'd', 'e']
    for (let i = 0; i < 200; i += 1) {
      const picked = pickAdversarialSources(images)
      expect(picked).toHaveLength(4)
      picked.forEach((image) =>
        expect(['a', 'b', 'c', 'd', 'e']).toContain(image)
      )
      expect(new Set(picked).size).toBe(4)
    }
  })

  it('takes four slots even when two hold the same picture', () => {
    // Used to loop forever: it wanted four different pictures.
    expect(pickAdversarialSources(['a', 'a', 'b', 'c']).sort()).toEqual([
      'a',
      'a',
      'b',
      'c',
    ])
  })

  it('gives none with fewer than four pictures', () => {
    expect(pickAdversarialSources(['a', undefined, 'b', 'c'])).toEqual([])
    expect(pickAdversarialSources(undefined)).toEqual([])
  })
})

describe('adversarialSources', () => {
  it('uses the search pictures when there are four', async () => {
    const found = ['s1', undefined, 's2', 's3', 's4']
    await expect(
      adversarialSources(found, ['p1', 'p2', 'p3'])
    ).resolves.toEqual(['s1', 's2', 's3', 's4'])
  })

  it('adds the story pictures when the search found fewer', async () => {
    await expect(
      adversarialSources(['s1', 's2'], ['p1', undefined, 'p2'])
    ).resolves.toEqual(['s1', 's2', 'p1', 'p2'])
  })

  it('gives what it has when there are no story pictures', async () => {
    await expect(
      adversarialSources(Array.from({length: 8}), [])
    ).resolves.toEqual([])
  })
})
